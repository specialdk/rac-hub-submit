import { Router } from 'express';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { getDriveClient, getSheetsClient } from './google-client.js';
import {
  ALLOWED_DESTINATIONS,
  STATUS_WAITING_APPROVAL,
  buildHeroContentRow,
  buildManagerRow,
  buildModalStoriesRow,
  driveImageUrl,
  extractBodyIndex,
  formatContentDate,
  nextContentNumberFromColumnA,
  normaliseText,
  photoFilename,
  rowToCellData,
} from './skill-helpers.js';

const router = Router();

// Same shared-secret pattern as /admin/notify. Duplicated here rather than
// importing — one less coupling between route files. If a third caller
// shows up, factor into a shared module.
function checkSkillSecret(req) {
  const expected = process.env.SKILL_NOTIFY_SECRET;
  if (!expected) return false;
  const provided = req.headers['x-skill-secret'];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function logSkill(endpoint, ok, reason, extra = {}) {
  console.log(JSON.stringify({ endpoint, ok, reason, ...extra }));
}

// ---- Sheet-id cache ------------------------------------------------------
// batchUpdate requests reference tabs by numeric sheetId, not name. Look
// it up once per process.
let cachedSheetIds = null;
async function getSheetIds(sheets, spreadsheetId) {
  if (cachedSheetIds) return cachedSheetIds;
  const resp = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const map = {};
  for (const s of resp.data.sheets || []) {
    map[s.properties.title] = s.properties.sheetId;
  }
  cachedSheetIds = map;
  return map;
}

// ---- Drive helpers -------------------------------------------------------

async function readSubmissionJson(drive, folderId) {
  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and name = 'submission.json'`,
    fields: 'files(id)',
    pageSize: 1,
  });
  const f = list.data.files?.[0];
  if (!f) return null;
  const dl = await drive.files.get({ fileId: f.id, alt: 'media' });
  // googleapis sometimes auto-parses JSON, sometimes returns a string
  return typeof dl.data === 'string' ? JSON.parse(dl.data) : dl.data;
}

async function listImageFiles(drive, folderId) {
  const resp = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'files(id, name, mimeType)',
    pageSize: 50,
  });
  return resp.data.files || [];
}

async function downloadFile(drive, fileId) {
  const resp = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(resp.data);
}

// Upload a file to Photos folder, set anyone-with-link reader permission so
// the lh3.googleusercontent.com URL works for the public Intranet, return
// the new file ID.
async function uploadPhoto(drive, photosFolderId, name, mimeType, buffer) {
  const create = await drive.files.create({
    requestBody: { name, parents: [photosFolderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
  await drive.permissions.create({
    fileId: create.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  });
  return create.data.id;
}

async function moveFolder(drive, folderId, newParentId, oldParentId) {
  await drive.files.update({
    fileId: folderId,
    addParents: newParentId,
    removeParents: oldParentId,
    fields: 'id, parents',
  });
}

// ---- Sheet write helpers -------------------------------------------------

async function readNextContentNumber(sheets, spreadsheetId, tabName) {
  const escaped = tabName.replace(/'/g, "\\'");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${escaped}'!A:A`,
  });
  return nextContentNumberFromColumnA(resp.data.values || []);
}

// Insert + populate row 2 in one or two tabs atomically via a single
// spreadsheets.batchUpdate call. inheritFromBefore=false on the inserted
// row means it doesn't carry formatting from row 1 (the header) — keeps
// the visible style consistent with other data rows.
async function insertAndPopulateTopRow(sheets, spreadsheetId, plans) {
  const sheetIds = await getSheetIds(sheets, spreadsheetId);
  const requests = [];
  for (const plan of plans) {
    const sheetIdNum = sheetIds[plan.tabName];
    if (sheetIdNum === undefined) {
      throw new Error(`Tab not found: ${plan.tabName}`);
    }
    requests.push({
      insertDimension: {
        range: { sheetId: sheetIdNum, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        inheritFromBefore: false,
      },
    });
  }
  for (const plan of plans) {
    const sheetIdNum = sheetIds[plan.tabName];
    requests.push({
      updateCells: {
        rows: [{ values: rowToCellData(plan.row) }],
        fields: 'userEnteredValue',
        start: { sheetId: sheetIdNum, rowIndex: 1, columnIndex: 0 },
      },
    });
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

// ---- GET /skill/pending --------------------------------------------------
// Lists every submission folder under DRIVE_SUBMISSIONS_FOLDER_ID and reads
// each folder's submission.json. The skill iterates this list, decides what
// each one needs (process or quarantine), and calls the relevant endpoint.
router.get('/skill/pending', async (req, res) => {
  if (!checkSkillSecret(req)) {
    logSkill('/skill/pending', false, 'BAD_SECRET');
    return res.status(401).json({ ok: false, error: 'BAD_SECRET' });
  }
  try {
    const drive = getDriveClient();
    const submissionsParent = process.env.DRIVE_SUBMISSIONS_FOLDER_ID;
    if (!submissionsParent) {
      console.error('skill/pending: DRIVE_SUBMISSIONS_FOLDER_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const folderList = await drive.files.list({
      q: `'${submissionsParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime',
      pageSize: 100,
    });

    const submissions = [];
    for (const folder of folderList.data.files || []) {
      try {
        const sub = await readSubmissionJson(drive, folder.id);
        if (!sub) {
          submissions.push({
            folder_id: folder.id,
            folder_name: folder.name,
            error: 'MISSING_SUBMISSION_JSON',
          });
          continue;
        }
        submissions.push({
          folder_id: folder.id,
          folder_name: folder.name,
          submission: sub,
        });
      } catch (err) {
        submissions.push({
          folder_id: folder.id,
          folder_name: folder.name,
          error: 'INVALID_SUBMISSION_JSON',
          message: err.message,
        });
      }
    }

    logSkill('/skill/pending', true, 'OK', { count: submissions.length });
    return res.json({ ok: true, submissions });
  } catch (err) {
    console.error('skill/pending error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// ---- POST /skill/process -------------------------------------------------
// The skill calls this after it has cleaned the text and resolved title +
// highlight (either from the submission's *_suggestion fields or generated).
// Body:
//   {
//     folder_id, cleaned_text, resolved_title, resolved_highlight,
//     admin_note (optional)
//   }
// Steps:
//   1. Read submission.json to get destination, submitter_name, banner/body filenames, submitted_at
//   2. Download images from the submission folder, upload to Photos with stable names
//   3. Compute next ContentNumber, build the row(s), insert + populate atomically
//   4. Move the submission folder from Submissions to Processed
// On any failure after step 2 starts, the skill should call /skill/quarantine
// to clean up — this endpoint does NOT auto-rollback uploaded photos.
router.post('/skill/process', async (req, res) => {
  if (!checkSkillSecret(req)) {
    logSkill('/skill/process', false, 'BAD_SECRET');
    return res.status(401).json({ ok: false, error: 'BAD_SECRET' });
  }

  try {
    const { folder_id, cleaned_text, resolved_title, resolved_highlight, admin_note } =
      req.body || {};

    if (typeof folder_id !== 'string' || !folder_id) {
      return res.status(400).json({ ok: false, error: 'INVALID_FOLDER_ID' });
    }
    if (typeof cleaned_text !== 'string' || cleaned_text.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_CLEANED_TEXT' });
    }
    if (typeof resolved_title !== 'string' || resolved_title.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_RESOLVED_TITLE' });
    }
    if (typeof resolved_highlight !== 'string' || resolved_highlight.trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'INVALID_RESOLVED_HIGHLIGHT' });
    }

    const drive = getDriveClient();
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    const submissionsParent = process.env.DRIVE_SUBMISSIONS_FOLDER_ID;
    const processedParent = process.env.DRIVE_PROCESSED_FOLDER_ID;
    const photosParent = process.env.DRIVE_PHOTOS_FOLDER_ID;
    if (!sheetId || !submissionsParent || !processedParent || !photosParent) {
      console.error('skill/process: missing env vars');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    // 1. Read submission.json
    let sub;
    try {
      sub = await readSubmissionJson(drive, folder_id);
    } catch (err) {
      logSkill('/skill/process', false, 'INVALID_SUBMISSION_JSON', { folder_id });
      return res.status(400).json({ ok: false, error: 'INVALID_SUBMISSION_JSON', message: err.message });
    }
    if (!sub) {
      logSkill('/skill/process', false, 'SUBMISSION_NOT_FOUND', { folder_id });
      return res.status(404).json({ ok: false, error: 'SUBMISSION_NOT_FOUND' });
    }
    if (!ALLOWED_DESTINATIONS.includes(sub.destination)) {
      logSkill('/skill/process', false, 'INVALID_DESTINATION_IN_SUBMISSION', {
        folder_id,
        destination: sub.destination,
      });
      return res
        .status(400)
        .json({ ok: false, error: 'INVALID_DESTINATION_IN_SUBMISSION' });
    }

    // 2. List + upload images
    const imageFiles = await listImageFiles(drive, folder_id);
    const banner = imageFiles.find((f) => /^banner\./.test(f.name));
    if (!banner) {
      logSkill('/skill/process', false, 'BANNER_MISSING_IN_FOLDER', { folder_id });
      return res.status(400).json({ ok: false, error: 'BANNER_MISSING_IN_FOLDER' });
    }
    const bodyImages = imageFiles
      .filter((f) => /^body-\d+\./.test(f.name))
      .sort((a, b) => extractBodyIndex(a.name) - extractBodyIndex(b.name));

    const cleanTitle = resolved_title.trim();
    const cleanHighlight = resolved_highlight.trim();
    const cleanedDescription = normaliseText(cleaned_text);
    const cleanAdminNote = typeof admin_note === 'string' ? admin_note.trim() : '';

    const bannerExt = banner.name.split('.').pop();
    const bannerBuffer = await downloadFile(drive, banner.id);
    const bannerNewName = photoFilename(sub.submitted_at, cleanTitle, 'banner', bannerExt);
    const bannerNewId = await uploadPhoto(
      drive,
      photosParent,
      bannerNewName,
      banner.mimeType,
      bannerBuffer,
    );
    const bannerUrl = driveImageUrl(bannerNewId);

    const bodyUrls = [];
    for (let i = 0; i < bodyImages.length; i++) {
      const f = bodyImages[i];
      const ext = f.name.split('.').pop();
      const buf = await downloadFile(drive, f.id);
      const newName = photoFilename(sub.submitted_at, cleanTitle, `body-${i + 1}`, ext);
      const newId = await uploadPhoto(drive, photosParent, newName, f.mimeType, buf);
      bodyUrls.push(driveImageUrl(newId));
    }

    // 3. Build sheet row(s) and write atomically
    const destination = sub.destination;
    const isGeneral = destination === 'General';
    const contentDate = formatContentDate(sub.submitted_at);
    const submittedBy = String(sub.submitter_name || '').trim();

    if (isGeneral) {
      const next = await readNextContentNumber(sheets, sheetId, 'Modal Stories');
      const modalRow = buildModalStoriesRow({
        contentNumber: next,
        contentDate,
        title: cleanTitle,
        description: cleanedDescription,
        highlight: cleanHighlight,
        finalUrl: bodyUrls.join(';'),
        leaderPhoto: bannerUrl,
        photoTitles: '',
        submittedBy,
        status: STATUS_WAITING_APPROVAL,
        adminNote: cleanAdminNote,
      });
      const heroRow = buildHeroContentRow({
        slideNumber: next,
        title: cleanTitle,
        subtitle: cleanHighlight,
        finalUrl: bannerUrl,
        shrink: 1,
        darkText: 'No',
        status: STATUS_WAITING_APPROVAL,
      });
      await insertAndPopulateTopRow(sheets, sheetId, [
        { tabName: 'Modal Stories', row: modalRow },
        { tabName: 'Hero Content', row: heroRow },
      ]);
    } else {
      const next = await readNextContentNumber(sheets, sheetId, destination);
      const row = buildManagerRow({
        contentNumber: next,
        contentDate,
        title: cleanTitle,
        description: cleanedDescription,
        highlight: cleanHighlight,
        finalUrl: [bannerUrl, ...bodyUrls].join(';'),
        leaderPhoto: bannerUrl,
        submittedBy,
        status: STATUS_WAITING_APPROVAL,
        adminNote: cleanAdminNote,
      });
      await insertAndPopulateTopRow(sheets, sheetId, [
        { tabName: destination, row },
      ]);
    }

    // 4. Move folder Submissions → Processed
    await moveFolder(drive, folder_id, processedParent, submissionsParent);

    logSkill('/skill/process', true, 'OK', {
      folder_id,
      destination,
      body_image_count: bodyImages.length,
    });
    return res.json({
      ok: true,
      destination,
      banner_url: bannerUrl,
      body_urls: bodyUrls,
    });
  } catch (err) {
    console.error('skill/process error:', err.stack || err.message);
    return res
      .status(500)
      .json({ ok: false, error: 'PROCESS_FAILED', message: err.message });
  }
});

// ---- POST /skill/quarantine ----------------------------------------------
// Writes an error.txt into the submission folder explaining what went
// wrong, then moves the folder Submissions → Quarantine. The skill calls
// this on validation failures (malformed submission.json, missing banner)
// or after /skill/process throws partway through.
router.post('/skill/quarantine', async (req, res) => {
  if (!checkSkillSecret(req)) {
    logSkill('/skill/quarantine', false, 'BAD_SECRET');
    return res.status(401).json({ ok: false, error: 'BAD_SECRET' });
  }
  try {
    const { folder_id, error_text } = req.body || {};
    if (typeof folder_id !== 'string' || !folder_id) {
      return res.status(400).json({ ok: false, error: 'INVALID_FOLDER_ID' });
    }

    const drive = getDriveClient();
    const submissionsParent = process.env.DRIVE_SUBMISSIONS_FOLDER_ID;
    const quarantineParent = process.env.DRIVE_QUARANTINE_FOLDER_ID;
    if (!submissionsParent || !quarantineParent) {
      console.error('skill/quarantine: missing env vars');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const reason =
      typeof error_text === 'string' && error_text.trim()
        ? error_text.trim()
        : 'No reason provided.';
    const stamp = new Date().toISOString();
    const body = `Quarantined at ${stamp}\n\n${reason}\n`;

    await drive.files.create({
      requestBody: { name: 'error.txt', parents: [folder_id] },
      media: { mimeType: 'text/plain', body: Readable.from(Buffer.from(body, 'utf8')) },
      fields: 'id',
    });

    await moveFolder(drive, folder_id, quarantineParent, submissionsParent);

    logSkill('/skill/quarantine', true, 'OK', { folder_id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('skill/quarantine error:', err.message);
    return res
      .status(500)
      .json({ ok: false, error: 'QUARANTINE_FAILED', message: err.message });
  }
});

export default router;

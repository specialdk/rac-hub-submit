import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import {
  ALLOWED_DESTINATIONS,
  TEXT_MIN,
  TEXT_MAX,
  MAX_TOTAL_BYTES,
  buildFolderBaseName,
  buildSubmissionJson,
  detectImageType,
  mimeFor,
  cleanText,
} from './submit.js';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient, getDriveClient } from './google-client.js';

const router = Router();

// In-memory storage so we can read magic bytes for type detection and
// re-stream into the Drive upload. Files are small (PWA resizes to ~2 MB)
// and total is capped at 20 MB, so memory pressure is fine.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // per-file cap; total enforced after parse
    files: 11,                   // banner + up to 10 body images
  },
});

const UPLOAD_FIELDS = [
  { name: 'banner', maxCount: 1 },
  ...Array.from({ length: 10 }, (_, i) => ({ name: `body_${i + 1}`, maxCount: 1 })),
];

// Wrap multer so its errors return a clean JSON response with the
// contract's error codes instead of bubbling up as a 500.
function uploadMiddleware(req, res, next) {
  upload.fields(UPLOAD_FIELDS)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      logSubmit(false, 'UPLOAD_TOO_LARGE');
      return res.status(413).json({ ok: false, error: 'UPLOAD_TOO_LARGE' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      logSubmit(false, 'UNEXPECTED_FILE_FIELD', { field: err.field });
      return res.status(400).json({ ok: false, error: 'UNEXPECTED_FILE_FIELD' });
    }
    logSubmit(false, 'UPLOAD_ERROR', { msg: err.message });
    return res.status(400).json({ ok: false, error: 'UPLOAD_ERROR' });
  });
}

function logSubmit(ok, reason, extra = {}) {
  console.log(JSON.stringify({ endpoint: '/submit', ok, reason, ...extra }));
}

router.post('/submit', uploadMiddleware, async (req, res) => {
  try {
    const {
      pin,
      destination,
      text,
      title_suggestion,
      highlight_suggestion,
      submitted_at,
    } = req.body || {};

    // ---- Cheap client-side mirrors of contract §6 (server is the authority)
    const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
    const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);
    if (typeof pin !== 'string' || !/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
      logSubmit(false, 'INVALID_PIN');
      return res.status(401).json({ ok: false, error: 'INVALID_PIN' });
    }

    if (!ALLOWED_DESTINATIONS.includes(destination)) {
      logSubmit(false, 'INVALID_DESTINATION');
      return res.status(400).json({ ok: false, error: 'INVALID_DESTINATION' });
    }

    const cleanedText = cleanText(text);
    if (cleanedText.length < TEXT_MIN || cleanedText.length > TEXT_MAX) {
      logSubmit(false, 'TEXT_LENGTH', { len: cleanedText.length });
      return res.status(400).json({ ok: false, error: 'TEXT_LENGTH' });
    }

    if (typeof submitted_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(submitted_at)) {
      logSubmit(false, 'INVALID_SUBMITTED_AT');
      return res.status(400).json({ ok: false, error: 'INVALID_SUBMITTED_AT' });
    }

    // ---- Banner: required, format-checked
    const bannerFile = req.files?.banner?.[0];
    if (!bannerFile) {
      logSubmit(false, 'BANNER_REQUIRED');
      return res.status(400).json({ ok: false, error: 'BANNER_REQUIRED' });
    }
    const bannerType = detectImageType(bannerFile.buffer);
    if (!bannerType) {
      logSubmit(false, 'BANNER_FORMAT');
      return res.status(400).json({ ok: false, error: 'BANNER_FORMAT' });
    }

    // ---- Body images: optional, ordered by field name body_1..body_10
    const bodyFiles = [];
    for (let i = 1; i <= 10; i++) {
      const f = req.files?.[`body_${i}`]?.[0];
      if (!f) continue;
      const type = detectImageType(f.buffer);
      if (!type) {
        logSubmit(false, 'BODY_FORMAT', { idx: i });
        return res.status(400).json({ ok: false, error: 'BODY_FORMAT' });
      }
      bodyFiles.push({ file: f, type });
    }

    // ---- Total size cap
    const totalBytes = bannerFile.size + bodyFiles.reduce((s, b) => s + b.file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      logSubmit(false, 'UPLOAD_TOO_LARGE', { bytes: totalBytes });
      return res.status(413).json({ ok: false, error: 'UPLOAD_TOO_LARGE' });
    }

    // ---- Authoritative PIN check against the Sheet
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }
    const sheetResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: USERS_RANGE,
    });
    const auth = findUserByPin(sheetResp.data.values || [], pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logSubmit(false, auth.error);
      return res.status(status).json(auth);
    }

    // ---- Write to Drive
    const drive = getDriveClient();
    const parentId = process.env.DRIVE_SUBMISSIONS_FOLDER_ID;
    if (!parentId) {
      console.error('DRIVE_SUBMISSIONS_FOLDER_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    const baseName = buildFolderBaseName(submitted_at, auth.name);
    const folderName = await pickAvailableFolderName(drive, parentId, baseName);

    const folderResp = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    const folderId = folderResp.data.id;

    const bannerFilename = `banner.${bannerType}`;
    const bodyFilenames = bodyFiles.map((b, i) => `body-${i + 1}.${b.type}`);

    const submissionJson = buildSubmissionJson({
      submitterName: auth.name,
      pin,
      destination,
      submittedAt: submitted_at,
      text: cleanedText,
      titleSuggestion: title_suggestion || null,
      highlightSuggestion: highlight_suggestion || null,
      bannerFilename,
      bodyFilenames,
    });

    await uploadFile(
      drive,
      folderId,
      'submission.json',
      'application/json',
      Buffer.from(JSON.stringify(submissionJson, null, 2), 'utf8'),
    );
    await uploadFile(drive, folderId, bannerFilename, mimeFor(bannerType), bannerFile.buffer);
    for (let i = 0; i < bodyFiles.length; i++) {
      const { file, type } = bodyFiles[i];
      await uploadFile(drive, folderId, bodyFilenames[i], mimeFor(type), file.buffer);
    }

    logSubmit(true, 'OK', { folder: folderName, body_count: bodyFiles.length });
    return res.json({ ok: true, folder_name: folderName });
  } catch (err) {
    console.error('submit error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

async function uploadFile(drive, folderId, name, mimeType, buffer) {
  return drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
}

// Pick a folder name that doesn't collide with an existing folder under
// the parent. Folder names are deterministic per minute per submitter,
// so collisions are rare — append `_2`, `_3`, ... only if needed.
async function pickAvailableFolderName(drive, parentId, baseName) {
  const exists = async (name) => {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const resp = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false and name = '${escaped}'`,
      fields: 'files(id)',
      pageSize: 1,
    });
    return (resp.data.files || []).length > 0;
  };
  if (!(await exists(baseName))) return baseName;
  for (let i = 2; i < 100; i++) {
    const candidate = `${baseName}_${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('TOO_MANY_COLLISIONS');
}

export default router;

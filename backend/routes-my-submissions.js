import { Router } from 'express';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient } from './google-client.js';

const router = Router();

// Manager tabs: A=ContentNumber, B=ContentDate, C=ContentTitle,
// D=ContentDescription, E=ContentHighlights, F=FinalURL, G=LeaderPhoto,
// H=SubmittedBy, I=Status, J=AdminNote (optional)
const MANAGER_TABS = [
  'CEO Messages',
  'Business Messages',
  'Operations Messages',
  'Community Messages',
  'Safety Messages',
];
const MANAGER_LIST_RANGE = (tab) => `'${tab}'!A:I`;
const MANAGER_DETAIL_RANGE = (tab) => `'${tab}'!A:J`;
const MANAGER = {
  contentNumber: 0,
  date: 1,
  title: 2,
  description: 3,
  highlight: 4,
  finalUrl: 5,
  leaderPhoto: 6,
  submittedBy: 7,
  status: 8,
  adminNote: 9,
};

// Modal Stories tab: A=ContentNumber, B=ContentDate, C=ContentTitle,
// D=ContentDescription, E=ContentHighlights, F=FinalURL, G=LeaderPhoto,
// H=PhotoTitles, I=SubmittedBy, J=Status, K=AdminNote (optional).
// Hero Content is intentionally skipped — it has no SubmittedBy.
const MODAL_TAB = 'Modal Stories';
const MODAL_LIST_RANGE = `'${MODAL_TAB}'!A:J`;
const MODAL_DETAIL_RANGE = `'${MODAL_TAB}'!A:K`;
const MODAL = {
  contentNumber: 0,
  date: 1,
  title: 2,
  description: 3,
  highlight: 4,
  finalUrl: 5,
  leaderPhoto: 6,
  photoTitles: 7,
  submittedBy: 8,
  status: 9,
  adminNote: 10,
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

const ALLOWED_DESTINATIONS_FOR_DETAIL = new Set([
  'General',
  ...MANAGER_TABS,
]);

function parseContentDate(s) {
  if (!s) return 0;
  // ContentDate is formatted as "Month D, YYYY" (e.g. "April 27, 2026")
  // by the skill. Date.parse accepts that shape across all major engines.
  const t = Date.parse(String(s));
  return Number.isNaN(t) ? 0 : t;
}

function rowToListEntry(row, idx, columns, destination) {
  return {
    title: String(row[columns.title] ?? '').trim(),
    destination,
    date: String(row[columns.date] ?? '').trim(),
    status: String(row[columns.status] ?? '').trim(),
    banner_url: String(row[columns.leaderPhoto] ?? '').trim(),
    row_number: idx + 1, // 1-indexed sheet row (header is row 1)
    _sortKey: parseContentDate(row[columns.date]),
  };
}

function pinValidationError(req) {
  const pin = typeof req.query.pin === 'string' ? req.query.pin.trim() : '';
  const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
  const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
    return { ok: false, status: 401, error: 'INVALID_PIN' };
  }
  return { ok: true, pin };
}

function logEndpoint(endpoint, ok, reason) {
  console.log(JSON.stringify({ endpoint, ok, reason }));
}

// ---- GET /my-submissions ---------------------------------------------------
// List view of the current user's submissions. Supports limit query param
// (default 10, max 30) for the "Show older" expansion in My Stories.
router.get('/my-submissions', async (req, res) => {
  const pinCheck = pinValidationError(req);
  if (!pinCheck.ok) {
    logEndpoint('/my-submissions', false, pinCheck.error);
    return res.status(pinCheck.status).json({ ok: false, error: pinCheck.error });
  }

  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    // Read Users tab + all six destination tabs in a single batchGet
    // round-trip (one HTTP call instead of seven).
    const ranges = [
      USERS_RANGE,
      MODAL_LIST_RANGE,
      ...MANAGER_TABS.map(MANAGER_LIST_RANGE),
    ];
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });
    const valueRanges = batch.data.valueRanges || [];

    const usersRows = valueRanges[0]?.values || [];
    const auth = findUserByPin(usersRows, pinCheck.pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logEndpoint('/my-submissions', false, auth.error);
      return res.status(status).json(auth);
    }
    const userName = auth.name;

    const collected = [];
    const matchesUser = (row, byIdx) =>
      String(row[byIdx] ?? '').trim() === userName;

    // Modal Stories (General)
    const modalRows = valueRanges[1]?.values || [];
    for (let i = 1; i < modalRows.length; i++) {
      const row = modalRows[i] || [];
      if (matchesUser(row, MODAL.submittedBy)) {
        collected.push(rowToListEntry(row, i, MODAL, 'General'));
      }
    }

    // Manager tabs
    for (let t = 0; t < MANAGER_TABS.length; t++) {
      const tabName = MANAGER_TABS[t];
      const rows = valueRanges[2 + t]?.values || [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        if (matchesUser(row, MANAGER.submittedBy)) {
          collected.push(rowToListEntry(row, i, MANAGER, tabName));
        }
      }
    }

    collected.sort((a, b) => b._sortKey - a._sortKey);
    const submissions = collected
      .slice(0, limit)
      .map(({ _sortKey, ...rest }) => rest);

    logEndpoint('/my-submissions', true, `count=${submissions.length}`);
    return res.json({ ok: true, submissions, total: collected.length });
  } catch (err) {
    console.error('my-submissions error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

// ---- GET /my-submission ----------------------------------------------------
// Detail view of a single submission. Self-only — verifies the requested row's
// SubmittedBy matches the PIN-holder's name. Returns the same shape as
// /admin/submission plus admin_note (for rejected stories) and status.
router.get('/my-submission', async (req, res) => {
  const pinCheck = pinValidationError(req);
  if (!pinCheck.ok) {
    logEndpoint('/my-submission', false, pinCheck.error);
    return res.status(pinCheck.status).json({ ok: false, error: pinCheck.error });
  }

  const destination =
    typeof req.query.destination === 'string' ? req.query.destination.trim() : '';
  const rowNumber = parseInt(req.query.row, 10);

  if (!ALLOWED_DESTINATIONS_FOR_DETAIL.has(destination)) {
    logEndpoint('/my-submission', false, 'INVALID_DESTINATION');
    return res.status(400).json({ ok: false, error: 'INVALID_DESTINATION' });
  }
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    logEndpoint('/my-submission', false, 'INVALID_ROW');
    return res.status(400).json({ ok: false, error: 'INVALID_ROW' });
  }

  const isGeneral = destination === 'General';
  const tabName = isGeneral ? MODAL_TAB : destination;
  const rangeForRow = isGeneral
    ? `'${MODAL_TAB}'!${rowNumber}:${rowNumber}`
    : `'${destination}'!${rowNumber}:${rowNumber}`;
  const layout = isGeneral ? MODAL : MANAGER;

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    // batchGet: Users (for PIN→name), then the requested row.
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: [USERS_RANGE, rangeForRow],
    });
    const usersRows = batch.data.valueRanges?.[0]?.values || [];
    const auth = findUserByPin(usersRows, pinCheck.pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logEndpoint('/my-submission', false, auth.error);
      return res.status(status).json(auth);
    }
    const userName = auth.name;

    const row = batch.data.valueRanges?.[1]?.values?.[0] || [];
    if (!row.length) {
      logEndpoint('/my-submission', false, 'NOT_FOUND');
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    // Self-only authorisation: caller's name must match the row's SubmittedBy.
    // This is the privacy boundary — without it any signed-in user could
    // read any row by guessing destination + row.
    const rowSubmittedBy = String(row[layout.submittedBy] ?? '').trim();
    if (rowSubmittedBy !== userName) {
      logEndpoint('/my-submission', false, 'NOT_OWNER');
      return res.status(403).json({ ok: false, error: 'NOT_OWNER' });
    }

    const finalUrl = String(row[layout.finalUrl] ?? '').trim();
    const bannerUrl = String(row[layout.leaderPhoto] ?? '').trim();
    const adminNote = String(row[layout.adminNote] ?? '').trim();

    // FinalURL is banner + body images joined with ';' (banner first, per
    // the post-fix contract). For the detail view, we surface the banner
    // separately (LeaderPhoto) and the body images as the rest of the list.
    const allUrls = finalUrl
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const bodyUrls = allUrls.filter((u) => u !== bannerUrl);

    const submission = {
      destination,
      row_number: rowNumber,
      title: String(row[layout.title] ?? '').trim(),
      highlight: String(row[layout.highlight] ?? '').trim(),
      text: String(row[layout.description] ?? '').trim(),
      banner_url: bannerUrl,
      body_urls: isGeneral ? bodyUrls : [],
      submitted_by: rowSubmittedBy,
      submitted_date: String(row[layout.date] ?? '').trim(),
      status: String(row[layout.status] ?? '').trim(),
      admin_note: adminNote,
    };

    logEndpoint('/my-submission', true, 'OK');
    return res.json({ ok: true, submission });
  } catch (err) {
    console.error('my-submission error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default router;

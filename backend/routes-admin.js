import { Router } from 'express';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient } from './google-client.js';
import {
  ADMIN_DESTINATIONS,
  HERO_LAYOUT,
  HERO_TAB,
  STATUS_APPROVED,
  STATUS_ARCHIVED,
  STATUS_WAITING,
  cellA1,
  findHeroRowByContentNumber,
  getTabLayout,
  hasAdminNoteColumn,
} from './admin-helpers.js';

const router = Router();

function logAdmin(endpoint, ok, reason, extra = {}) {
  console.log(JSON.stringify({ endpoint, ok, reason, ...extra }));
}

/* Validates the request's PIN against the Users tab and confirms the user
   has Admin role. Reads the Sheets API once. Returns either
   { ok: true, user } or { ok: false, status, error }. */
async function requireAdmin(req, sheets, sheetId) {
  const pinFromBody = req.body && typeof req.body.pin === 'string' ? req.body.pin : '';
  const pinFromQuery = req.query && typeof req.query.pin === 'string' ? req.query.pin : '';
  const pin = (pinFromBody || pinFromQuery).trim();

  const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
  const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
    return { ok: false, status: 401, error: 'INVALID_PIN' };
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: USERS_RANGE,
  });
  const auth = findUserByPin(resp.data.values || [], pin);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.error === 'INACTIVE_USER' ? 403 : 401,
      error: auth.error,
    };
  }
  if (auth.role !== 'Admin') {
    return { ok: false, status: 403, error: 'NOT_ADMIN' };
  }
  return { ok: true, user: auth };
}

function ensureSheetIdSet(res) {
  const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
  if (!sheetId) {
    console.error('INTRANET_CONTROL_SHEET_ID not set');
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    return null;
  }
  return sheetId;
}

/* ---- GET /admin/pending --------------------------------------------------
   Returns Waiting Approval rows across Modal Stories + the 5 Manager tabs.
   Hero Content is excluded — it has no SubmittedBy column and is the
   linked partner row of the General Modal Stories row anyway, so it
   would just duplicate the queue entry. */
router.get('/admin/pending', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const sheetId = ensureSheetIdSet(res);
    if (!sheetId) return;

    const auth = await requireAdmin(req, sheets, sheetId);
    if (!auth.ok) {
      logAdmin('/admin/pending', false, auth.error);
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    const ranges = ADMIN_DESTINATIONS.map((d) => {
      const t = getTabLayout(d);
      return `'${t.tabName}'!${t.layout.range}`;
    });
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });

    const submissions = [];
    for (let i = 0; i < ADMIN_DESTINATIONS.length; i++) {
      const dest = ADMIN_DESTINATIONS[i];
      const t = getTabLayout(dest);
      const rows = batch.data.valueRanges?.[i]?.values || [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const status = String(row[t.layout.status] ?? '').trim();
        if (status !== STATUS_WAITING) continue;
        submissions.push({
          title: String(row[t.layout.contentTitle] ?? '').trim(),
          destination: dest,
          submitted_by: String(row[t.layout.submittedBy] ?? '').trim(),
          submitted_date: String(row[t.layout.contentDate] ?? '').trim(),
          row_number: r + 1, // 1-indexed
          _sortKey: Date.parse(String(row[t.layout.contentDate] ?? '')) || 0,
        });
      }
    }
    submissions.sort((a, b) => b._sortKey - a._sortKey);
    const out = submissions.map(({ _sortKey, ...rest }) => rest);

    logAdmin('/admin/pending', true, `count=${out.length}`);
    return res.json({ ok: true, submissions: out });
  } catch (err) {
    console.error('admin/pending error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/* ---- GET /admin/submission?destination={d}&row={n} ----------------------
   Returns the data needed to render one row in the Review Detail screen.
   Only rows still in Waiting Approval are returned — already-approved or
   already-archived rows return NOT_FOUND so admin can't accidentally re-
   action them. */
router.get('/admin/submission', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const sheetId = ensureSheetIdSet(res);
    if (!sheetId) return;

    const auth = await requireAdmin(req, sheets, sheetId);
    if (!auth.ok) {
      logAdmin('/admin/submission', false, auth.error);
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    const destination = req.query.destination;
    const rowNumber = parseInt(req.query.row, 10);
    const t = getTabLayout(destination);
    if (!t) {
      logAdmin('/admin/submission', false, 'INVALID_DESTINATION');
      return res.status(400).json({ ok: false, error: 'INVALID_DESTINATION' });
    }
    if (!Number.isInteger(rowNumber) || rowNumber < 2) {
      logAdmin('/admin/submission', false, 'INVALID_ROW');
      return res.status(400).json({ ok: false, error: 'INVALID_ROW' });
    }

    const range = `'${t.tabName}'!${rowNumber}:${rowNumber}`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });
    const row = (resp.data.values || [])[0] || [];
    if (!row.length) {
      logAdmin('/admin/submission', false, 'NOT_FOUND', { destination, rowNumber });
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }
    const status = String(row[t.layout.status] ?? '').trim();
    if (status !== STATUS_WAITING) {
      logAdmin('/admin/submission', false, 'NOT_FOUND', { destination, rowNumber, status });
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    const isGeneral = destination === 'General';
    const finalUrl = String(row[t.layout.finalUrl] ?? '').trim();
    const submission = {
      destination,
      row_number: rowNumber,
      title: String(row[t.layout.contentTitle] ?? '').trim(),
      highlight: String(row[t.layout.contentHighlights] ?? '').trim(),
      text: String(row[t.layout.contentDescription] ?? '').trim(),
      banner_url: String(row[t.layout.leaderPhoto] ?? '').trim(),
      // Manager destinations only show a banner; body images aren't displayed
      body_urls: isGeneral
        ? finalUrl.split(';').map((s) => s.trim()).filter(Boolean)
        : [],
      submitted_by: String(row[t.layout.submittedBy] ?? '').trim(),
      submitted_date: String(row[t.layout.contentDate] ?? '').trim(),
    };

    logAdmin('/admin/submission', true, 'OK', { destination, rowNumber });
    return res.json({ ok: true, submission });
  } catch (err) {
    console.error('admin/submission error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/* Shared logic for approve and reject. Reads header + target row (and
   Hero Content column A for General submissions), validates, then issues
   one batchUpdate that changes one or two Status cells (and optionally
   an AdminNote cell). */
async function flipStatus({ sheets, sheetId, destination, rowNumber, newStatus, reason }) {
  const t = getTabLayout(destination);
  if (!t) return { ok: false, status: 400, error: 'INVALID_DESTINATION' };
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return { ok: false, status: 400, error: 'INVALID_ROW' };
  }

  const ranges = [
    `'${t.tabName}'!1:1`,
    `'${t.tabName}'!${rowNumber}:${rowNumber}`,
  ];
  if (destination === 'General') {
    ranges.push(`'${HERO_TAB}'!A:A`);
  }

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges,
  });

  const headerRow = batch.data.valueRanges?.[0]?.values?.[0] || [];
  const targetRow = batch.data.valueRanges?.[1]?.values?.[0] || [];
  if (!targetRow.length) return { ok: false, status: 404, error: 'NOT_FOUND' };

  const currentStatus = String(targetRow[t.layout.status] ?? '').trim();
  if (currentStatus !== STATUS_WAITING) {
    return { ok: false, status: 409, error: 'NOT_PENDING' };
  }

  const updates = [
    {
      range: cellA1(t.tabName, t.layout.statusColLetter, rowNumber),
      values: [[newStatus]],
    },
  ];

  if (reason && hasAdminNoteColumn(headerRow, t.layout)) {
    updates.push({
      range: cellA1(t.tabName, t.layout.adminNoteColLetter, rowNumber),
      values: [[reason]],
    });
  }

  if (destination === 'General') {
    const contentNumber = String(targetRow[t.layout.contentNumber] ?? '').trim();
    const heroACol = batch.data.valueRanges?.[2]?.values || [];
    const heroRowNumber = findHeroRowByContentNumber(heroACol, contentNumber);
    if (!heroRowNumber) {
      return { ok: false, status: 500, error: 'HERO_ROW_NOT_FOUND' };
    }
    updates.push({
      range: cellA1(HERO_TAB, HERO_LAYOUT.statusColLetter, heroRowNumber),
      values: [[newStatus]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });

  return { ok: true, updates: updates.length };
}

/* ---- POST /admin/approve ------------------------------------------------- */
router.post('/admin/approve', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const sheetId = ensureSheetIdSet(res);
    if (!sheetId) return;

    const auth = await requireAdmin(req, sheets, sheetId);
    if (!auth.ok) {
      logAdmin('/admin/approve', false, auth.error);
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    const { destination, row_number } = req.body || {};
    const result = await flipStatus({
      sheets,
      sheetId,
      destination,
      rowNumber: parseInt(row_number, 10),
      newStatus: STATUS_APPROVED,
    });
    if (!result.ok) {
      logAdmin('/admin/approve', false, result.error, { destination, row_number });
      return res.status(result.status).json({ ok: false, error: result.error });
    }

    logAdmin('/admin/approve', true, 'OK', { destination, row_number, cells: result.updates });
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin/approve error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

/* ---- POST /admin/reject -------------------------------------------------- */
router.post('/admin/reject', async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const sheetId = ensureSheetIdSet(res);
    if (!sheetId) return;

    const auth = await requireAdmin(req, sheets, sheetId);
    if (!auth.ok) {
      logAdmin('/admin/reject', false, auth.error);
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }

    const { destination, row_number, reason } = req.body || {};
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    const result = await flipStatus({
      sheets,
      sheetId,
      destination,
      rowNumber: parseInt(row_number, 10),
      newStatus: STATUS_ARCHIVED,
      reason: cleanReason,
    });
    if (!result.ok) {
      logAdmin('/admin/reject', false, result.error, { destination, row_number });
      return res.status(result.status).json({ ok: false, error: result.error });
    }

    logAdmin('/admin/reject', true, 'OK', {
      destination,
      row_number,
      cells: result.updates,
      hasReason: !!cleanReason,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin/reject error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default router;

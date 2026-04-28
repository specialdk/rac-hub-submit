import { Router } from 'express';
import { findUserByPin, USERS_RANGE } from './auth.js';
import { getSheetsClient } from './google-client.js';

const router = Router();

// Manager tabs: A=ContentNumber, B=ContentDate, C=ContentTitle,
// D=ContentDescription, E=ContentHighlights, F=FinalURL, G=LeaderPhoto,
// H=SubmittedBy, I=Status
const MANAGER_TABS = [
  'CEO Messages',
  'Business Messages',
  'Operations Messages',
  'Community Messages',
  'Safety Messages',
];
const MANAGER_RANGE = (tab) => `'${tab}'!A:I`;
const MANAGER = { date: 1, title: 2, submittedBy: 7, status: 8 };

// Modal Stories tab: same as Manager tabs through G, then H=PhotoTitles,
// I=SubmittedBy, J=Status. Hero Content has no SubmittedBy column so
// it is intentionally skipped per the brief.
const MODAL_TAB = 'Modal Stories';
const MODAL_RANGE = `'${MODAL_TAB}'!A:J`;
const MODAL = { date: 1, title: 2, submittedBy: 8, status: 9 };

const MAX_RESULTS = 10;

function parseContentDate(s) {
  if (!s) return 0;
  // ContentDate is formatted as "Month D, YYYY" (e.g. "April 27, 2026")
  // by the skill. Date.parse accepts that shape across all major engines.
  const t = Date.parse(String(s));
  return Number.isNaN(t) ? 0 : t;
}

function rowToSubmission(row, idx, columns, destination) {
  return {
    title: String(row[columns.title] ?? '').trim(),
    destination,
    date: String(row[columns.date] ?? '').trim(),
    status: String(row[columns.status] ?? '').trim(),
    row_number: idx + 1, // 1-indexed sheet row (header is row 1)
    _sortKey: parseContentDate(row[columns.date]),
  };
}

function logEndpoint(ok, reason) {
  console.log(JSON.stringify({ endpoint: '/my-submissions', ok, reason }));
}

router.get('/my-submissions', async (req, res) => {
  const pin = typeof req.query.pin === 'string' ? req.query.pin.trim() : '';

  const min = parseInt(process.env.PIN_LENGTH_MIN || '4', 10);
  const max = parseInt(process.env.PIN_LENGTH_MAX || '6', 10);
  if (!/^\d+$/.test(pin) || pin.length < min || pin.length > max) {
    logEndpoint(false, 'INVALID_PIN');
    return res.status(401).json({ ok: false, error: 'INVALID_PIN' });
  }

  try {
    const sheets = getSheetsClient();
    const sheetId = process.env.INTRANET_CONTROL_SHEET_ID;
    if (!sheetId) {
      console.error('INTRANET_CONTROL_SHEET_ID not set');
      return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
    }

    // Read Users tab + all six destination tabs in a single batchGet
    // round-trip (one HTTP call instead of seven).
    const ranges = [USERS_RANGE, MODAL_RANGE, ...MANAGER_TABS.map(MANAGER_RANGE)];
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });
    const valueRanges = batch.data.valueRanges || [];

    // Slot 0: Users
    const usersRows = valueRanges[0]?.values || [];
    const auth = findUserByPin(usersRows, pin);
    if (!auth.ok) {
      const status = auth.error === 'INACTIVE_USER' ? 403 : 401;
      logEndpoint(false, auth.error);
      return res.status(status).json(auth);
    }
    const userName = auth.name;

    // Filter each tab's rows to ones submitted by this user
    const collected = [];
    const matchesUser = (row, byIdx) =>
      String(row[byIdx] ?? '').trim() === userName;

    // Slot 1: Modal Stories (General)
    const modalRows = valueRanges[1]?.values || [];
    for (let i = 1; i < modalRows.length; i++) {
      const row = modalRows[i] || [];
      if (matchesUser(row, MODAL.submittedBy)) {
        collected.push(rowToSubmission(row, i, MODAL, 'General'));
      }
    }

    // Slots 2..6: Manager tabs in order
    for (let t = 0; t < MANAGER_TABS.length; t++) {
      const tabName = MANAGER_TABS[t];
      const rows = valueRanges[2 + t]?.values || [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        if (matchesUser(row, MANAGER.submittedBy)) {
          collected.push(rowToSubmission(row, i, MANAGER, tabName));
        }
      }
    }

    // Sort by parsed ContentDate desc, then take top 10. Strip the sort
    // key out of the response.
    collected.sort((a, b) => b._sortKey - a._sortKey);
    const submissions = collected.slice(0, MAX_RESULTS).map(({ _sortKey, ...rest }) => rest);

    logEndpoint(true, `count=${submissions.length}`);
    return res.json({ ok: true, submissions });
  } catch (err) {
    console.error('my-submissions error:', err.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
});

export default router;

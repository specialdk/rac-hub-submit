// Pure helpers for the /skill/* endpoints. No I/O — separated from the
// route layer so they're unit-testable without network or fixtures.

import { ALLOWED_DESTINATIONS } from './submit.js';

export const STATUS_WAITING_APPROVAL = 'Waiting Approval';

// Slugify a title for use in image filenames stored in Photos.
// "Tripod Wins!" → "tripod-wins". Same NFD-strip-and-collapse approach
// as slugifyName in submit.js.
export function slugifyTitle(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Build the photo filename per contract §3 "Photo storage naming":
//   {date}_{slugified-title}_{role}.{ext}
// Example: 2026-04-27_tripod-wins_banner.jpg
export function photoFilename(submittedAtIso, title, role, ext) {
  const date = (submittedAtIso || '').slice(0, 10) || 'undated';
  const slug = slugifyTitle(title) || 'untitled';
  return `${date}_${slug}_${role}.${ext}`;
}

// Build a public-readable Drive image URL — the format used in
// FinalURL / LeaderPhoto cells per contract §7.
export function driveImageUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

// Format ContentDate from an ISO submitted_at string into "Month D, YYYY"
// (per contract §7). Date is parsed off the ISO prefix, so timezone offset
// doesn't matter — what the submitter saw on their wall clock is what
// goes into the sheet.
export function formatContentDate(submittedAtIso) {
  if (!submittedAtIso) return '';
  const m = String(submittedAtIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const [, y, mo, d] = m;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthIdx = parseInt(mo, 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return '';
  return `${months[monthIdx]} ${parseInt(d, 10)}, ${y}`;
}

// Lightweight cleanup applied to text before it goes into ContentDescription.
// The skill does heavier cleaning (smart quotes, fillers) and passes us the
// already-cleaned text, but we still trim and CRLF-normalise as defence in
// depth.
export function normaliseText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

// Extract the numeric body-image index from a filename like "body-2.jpg".
// Returns 0 for non-matching strings (falls to the front in sort).
export function extractBodyIndex(filename) {
  const m = String(filename || '').match(/^body-(\d+)\./);
  return m ? parseInt(m[1], 10) : 0;
}

// ---- Row builders per contract §7 ----

// Manager destination tab: A=ContentNumber, B=ContentDate, C=ContentTitle,
// D=ContentDescription, E=ContentHighlights, F=FinalURL, G=LeaderPhoto,
// H=SubmittedBy, I=Status, J=AdminNote.
// FinalURL for Manager tabs is banner + body images joined with ';'
// (contract §7 — those tabs render only a banner via LeaderPhoto, but
// the brief still wants every image URL captured for traceability).
export function buildManagerRow({
  contentNumber,
  contentDate,
  title,
  description,
  highlight,
  finalUrl,
  leaderPhoto,
  submittedBy,
  status,
  adminNote,
}) {
  return [
    contentNumber,
    contentDate,
    title,
    description,
    highlight,
    finalUrl,
    leaderPhoto,
    submittedBy,
    status,
    adminNote || '',
  ];
}

// Modal Stories tab (General destination, row 1):
// A=ContentNumber, B=ContentDate, C=ContentTitle, D=ContentDescription,
// E=ContentHighlights, F=FinalURL (body images only), G=LeaderPhoto (banner),
// H=PhotoTitles (empty in v1), I=SubmittedBy, J=Status, K=AdminNote.
export function buildModalStoriesRow({
  contentNumber,
  contentDate,
  title,
  description,
  highlight,
  finalUrl,
  leaderPhoto,
  photoTitles,
  submittedBy,
  status,
  adminNote,
}) {
  return [
    contentNumber,
    contentDate,
    title,
    description,
    highlight,
    finalUrl,
    leaderPhoto,
    photoTitles || '',
    submittedBy,
    status,
    adminNote || '',
  ];
}

// Hero Content tab (General destination, row 2):
// A=SlideNumber (= Modal Stories ContentNumber), B=Title, C=Subtitle,
// D=FinalURL (banner only), E=Shrink (default 1), F=DarkText (default "No"),
// G=Status. No SubmittedBy, no AdminNote on this tab.
export function buildHeroContentRow({
  slideNumber,
  title,
  subtitle,
  finalUrl,
  shrink,
  darkText,
  status,
}) {
  return [
    slideNumber,
    title,
    subtitle,
    finalUrl,
    shrink ?? 1,
    darkText ?? 'No',
    status,
  ];
}

// Convert a row of plain values into Sheets API CellData[] objects for use
// in batchUpdate updateCells requests. Numbers become numberValue cells,
// everything else becomes stringValue.
export function rowToCellData(row) {
  return row.map((value) => {
    if (value === null || value === undefined || value === '') {
      return { userEnteredValue: { stringValue: '' } };
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { userEnteredValue: { numberValue: value } };
    }
    return { userEnteredValue: { stringValue: String(value) } };
  });
}

// Walk column A of a tab's values (rows array including header at index 0)
// and return MAX(existing) + 1. Returns 1 for an empty tab. Guards against
// non-numeric values in the column.
export function nextContentNumberFromColumnA(rows) {
  if (!Array.isArray(rows)) return 1;
  let max = 0;
  for (let i = 1; i < rows.length; i++) {
    const cell = (rows[i] || [])[0];
    const n = parseInt(cell, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export { ALLOWED_DESTINATIONS };

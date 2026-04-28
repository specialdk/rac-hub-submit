// Sheet column layouts for the admin endpoints. Single source of truth
// for "what column is what" across destination tabs.
//
// Manager tabs (CEO / Business / Operations / Community / Safety Messages):
//   A=ContentNumber  B=ContentDate     C=ContentTitle   D=ContentDescription
//   E=ContentHighlights F=FinalURL    G=LeaderPhoto    H=SubmittedBy
//   I=Status        J=AdminNote (optional)
//
// Modal Stories tab (used for General destination):
//   A=ContentNumber  B=ContentDate     C=ContentTitle   D=ContentDescription
//   E=ContentHighlights F=FinalURL    G=LeaderPhoto    H=PhotoTitles
//   I=SubmittedBy   J=Status         K=AdminNote (optional)
//
// Hero Content tab (paired with Modal Stories for General):
//   A=SlideNumber   B=Title           C=Subtitle       D=FinalURL
//   E=Shrink        F=DarkText        G=Status

const MANAGER_LAYOUT = {
  range: 'A:J', // includes optional AdminNote column
  contentNumber: 0,
  contentDate: 1,
  contentTitle: 2,
  contentDescription: 3,
  contentHighlights: 4,
  finalUrl: 5,
  leaderPhoto: 6,
  submittedBy: 7,
  status: 8,
  adminNote: 9,
  statusColLetter: 'I',
  adminNoteColLetter: 'J',
};

const MODAL_LAYOUT = {
  range: 'A:K',
  contentNumber: 0,
  contentDate: 1,
  contentTitle: 2,
  contentDescription: 3,
  contentHighlights: 4,
  finalUrl: 5,
  leaderPhoto: 6,
  photoTitles: 7,
  submittedBy: 8,
  status: 9,
  adminNote: 10,
  statusColLetter: 'J',
  adminNoteColLetter: 'K',
};

export const HERO_TAB = 'Hero Content';
export const HERO_LAYOUT = {
  range: 'A:G',
  slideNumber: 0,
  title: 1,
  subtitle: 2,
  finalUrl: 3,
  shrink: 4,
  darkText: 5,
  status: 6,
  statusColLetter: 'G',
};

// destination → tab name + layout
const TABS = {
  General: { tabName: 'Modal Stories', layout: MODAL_LAYOUT },
  'CEO Messages': { tabName: 'CEO Messages', layout: MANAGER_LAYOUT },
  'Business Messages': { tabName: 'Business Messages', layout: MANAGER_LAYOUT },
  'Operations Messages': { tabName: 'Operations Messages', layout: MANAGER_LAYOUT },
  'Community Messages': { tabName: 'Community Messages', layout: MANAGER_LAYOUT },
  'Safety Messages': { tabName: 'Safety Messages', layout: MANAGER_LAYOUT },
};

export const ADMIN_DESTINATIONS = Object.keys(TABS);

// Status string literals — must match the Intranet's filter exactly.
// No trimming, no case folding anywhere these are compared.
export const STATUS_WAITING = 'Waiting Approval';
export const STATUS_APPROVED = 'Approved';
export const STATUS_ARCHIVED = 'Archived';

export function getTabLayout(destination) {
  return TABS[destination] || null;
}

// True if the given header row has the literal text "AdminNote" in the
// expected column for this layout. The column is reserved either way;
// the backend just doesn't write to it unless it's been labelled.
export function hasAdminNoteColumn(headerRow, layout) {
  if (!Array.isArray(headerRow)) return false;
  const cell = headerRow[layout.adminNote];
  return typeof cell === 'string' && cell.trim() === 'AdminNote';
}

// Build a Sheets A1 range targeting a single cell, with the tab name
// safely single-quoted (handles spaces and apostrophes in tab names).
export function cellA1(tabName, colLetter, rowNumber) {
  const escaped = String(tabName).replace(/'/g, "\\'");
  return `'${escaped}'!${colLetter}${rowNumber}`;
}

// Find the Hero Content row whose SlideNumber (column A) matches the given
// content number. Takes the column-A values (rows array, first row is the
// header). Returns the 1-indexed sheet row, or null if no match.
export function findHeroRowByContentNumber(heroAColumn, contentNumber) {
  if (!Array.isArray(heroAColumn) || contentNumber == null || contentNumber === '') {
    return null;
  }
  const target = String(contentNumber).trim();
  for (let i = 1; i < heroAColumn.length; i++) {
    const row = heroAColumn[i] || [];
    const cell = String(row[0] ?? '').trim();
    if (cell === target) return i + 1; // 1-indexed
  }
  return null;
}

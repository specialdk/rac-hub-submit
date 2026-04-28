import { test } from 'node:test';
import assert from 'node:assert/strict';
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
} from '../admin-helpers.js';

// ---- destination constants
test('ADMIN_DESTINATIONS lists General first then 5 Manager tabs', () => {
  assert.deepEqual(ADMIN_DESTINATIONS, [
    'General',
    'CEO Messages',
    'Business Messages',
    'Operations Messages',
    'Community Messages',
    'Safety Messages',
  ]);
});

test('status constants match the Intranet exactly (no trim, no case fold)', () => {
  assert.equal(STATUS_WAITING, 'Waiting Approval');
  assert.equal(STATUS_APPROVED, 'Approved');
  assert.equal(STATUS_ARCHIVED, 'Archived');
});

// ---- getTabLayout
test('getTabLayout maps General to Modal Stories with the right shape', () => {
  const t = getTabLayout('General');
  assert.equal(t.tabName, 'Modal Stories');
  assert.equal(t.layout.range, 'A:K');
  assert.equal(t.layout.contentNumber, 0);
  assert.equal(t.layout.contentTitle, 2);
  assert.equal(t.layout.submittedBy, 8); // I
  assert.equal(t.layout.status, 9); // J
  assert.equal(t.layout.adminNote, 10); // K
  assert.equal(t.layout.statusColLetter, 'J');
  assert.equal(t.layout.adminNoteColLetter, 'K');
});

test('getTabLayout maps Manager destinations consistently', () => {
  for (const d of ['CEO Messages', 'Business Messages', 'Safety Messages']) {
    const t = getTabLayout(d);
    assert.equal(t.tabName, d);
    assert.equal(t.layout.range, 'A:J');
    assert.equal(t.layout.submittedBy, 7); // H
    assert.equal(t.layout.status, 8); // I
    assert.equal(t.layout.adminNote, 9); // J
    assert.equal(t.layout.statusColLetter, 'I');
  }
});

test('getTabLayout returns null for unknown destination', () => {
  assert.equal(getTabLayout('Unknown Tab'), null);
  assert.equal(getTabLayout(''), null);
  assert.equal(getTabLayout(undefined), null);
});

// ---- HERO_LAYOUT
test('HERO_LAYOUT has Status at column G', () => {
  assert.equal(HERO_LAYOUT.status, 6);
  assert.equal(HERO_LAYOUT.statusColLetter, 'G');
  assert.equal(HERO_TAB, 'Hero Content');
});

// ---- hasAdminNoteColumn
test('hasAdminNoteColumn detects exact "AdminNote" header in the right column', () => {
  const layout = getTabLayout('CEO Messages').layout;
  // Header row with AdminNote in column J (index 9)
  const header = ['ContentNumber', 'ContentDate', 'ContentTitle', 'ContentDescription',
                  'ContentHighlights', 'FinalURL', 'LeaderPhoto', 'SubmittedBy',
                  'Status', 'AdminNote'];
  assert.equal(hasAdminNoteColumn(header, layout), true);
});

test('hasAdminNoteColumn returns false if the cell is missing or different', () => {
  const layout = getTabLayout('CEO Messages').layout;
  const header9 = ['', '', '', '', '', '', '', '', 'Status']; // only 9 columns
  assert.equal(hasAdminNoteColumn(header9, layout), false);

  const headerWrong = ['', '', '', '', '', '', '', '', 'Status', 'Notes'];
  assert.equal(hasAdminNoteColumn(headerWrong, layout), false);

  const headerCase = ['', '', '', '', '', '', '', '', 'Status', 'admin note'];
  assert.equal(hasAdminNoteColumn(headerCase, layout), false);
});

test('hasAdminNoteColumn returns false on non-array input', () => {
  const layout = getTabLayout('CEO Messages').layout;
  assert.equal(hasAdminNoteColumn(null, layout), false);
  assert.equal(hasAdminNoteColumn(undefined, layout), false);
  assert.equal(hasAdminNoteColumn('not an array', layout), false);
});

// ---- cellA1
test('cellA1 produces a quoted A1 range for tab names with spaces', () => {
  assert.equal(cellA1('Modal Stories', 'J', 5), "'Modal Stories'!J5");
  assert.equal(cellA1('Hero Content', 'G', 12), "'Hero Content'!G12");
});

test('cellA1 escapes apostrophes in tab names', () => {
  assert.equal(cellA1("Sam's Tab", 'A', 1), "'Sam\\'s Tab'!A1");
});

// ---- findHeroRowByContentNumber
test('findHeroRowByContentNumber returns the 1-indexed sheet row for a match', () => {
  const heroACol = [
    ['SlideNumber'],
    ['1'],
    ['2'],
    ['3'],
  ];
  assert.equal(findHeroRowByContentNumber(heroACol, '2'), 3);
  assert.equal(findHeroRowByContentNumber(heroACol, 1), 2);
  assert.equal(findHeroRowByContentNumber(heroACol, 3), 4);
});

test('findHeroRowByContentNumber returns null when no match', () => {
  const heroACol = [
    ['SlideNumber'],
    ['1'],
    ['2'],
  ];
  assert.equal(findHeroRowByContentNumber(heroACol, '99'), null);
});

test('findHeroRowByContentNumber trims whitespace before comparing', () => {
  const heroACol = [
    ['SlideNumber'],
    ['  5  '],
  ];
  assert.equal(findHeroRowByContentNumber(heroACol, 5), 2);
  assert.equal(findHeroRowByContentNumber(heroACol, '5'), 2);
});

test('findHeroRowByContentNumber handles missing/empty input', () => {
  assert.equal(findHeroRowByContentNumber(null, 1), null);
  assert.equal(findHeroRowByContentNumber([], 1), null);
  assert.equal(findHeroRowByContentNumber([['SlideNumber']], 1), null); // header only
  assert.equal(findHeroRowByContentNumber([['SlideNumber'], ['1']], null), null);
  assert.equal(findHeroRowByContentNumber([['SlideNumber'], ['1']], ''), null);
});

test('findHeroRowByContentNumber skips header at index 0 even if it matches', () => {
  // Header literally has the text "5" — should still skip it
  const heroACol = [['5'], ['10']];
  assert.equal(findHeroRowByContentNumber(heroACol, '5'), null);
});

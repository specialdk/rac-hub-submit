import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  slugifyTitle,
} from '../skill-helpers.js';

// ---- constants
test('STATUS_WAITING_APPROVAL matches the live-Intranet filter exactly', () => {
  assert.equal(STATUS_WAITING_APPROVAL, 'Waiting Approval');
});

test('ALLOWED_DESTINATIONS reuses the same list as submit.js', () => {
  assert.equal(ALLOWED_DESTINATIONS[0], 'General');
  assert.equal(ALLOWED_DESTINATIONS.length, 6);
});

// ---- slugifyTitle
test('slugifyTitle lowercases and hyphenates', () => {
  assert.equal(slugifyTitle('Tripod Wins!'), 'tripod-wins');
});

test('slugifyTitle strips diacritics and collapses non-alphanumerics', () => {
  assert.equal(slugifyTitle('Renée — vol. 2'), 'renee-vol-2');
});

test('slugifyTitle empty input becomes empty string', () => {
  assert.equal(slugifyTitle(''), '');
  assert.equal(slugifyTitle(null), '');
  assert.equal(slugifyTitle(undefined), '');
});

// ---- photoFilename
test('photoFilename builds {date}_{slug}_{role}.{ext}', () => {
  assert.equal(
    photoFilename('2026-04-27T14:32:11+09:30', 'Tripod Wins', 'banner', 'jpg'),
    '2026-04-27_tripod-wins_banner.jpg',
  );
});

test('photoFilename body role with index', () => {
  assert.equal(
    photoFilename('2026-04-27T14:32:11+09:30', 'Lucky Band', 'body-2', 'png'),
    '2026-04-27_lucky-band_body-2.png',
  );
});

test('photoFilename falls back to "untitled" and "undated" gracefully', () => {
  assert.equal(photoFilename('', '', 'banner', 'jpg'), 'undated_untitled_banner.jpg');
  assert.equal(photoFilename(null, null, 'banner', 'jpg'), 'undated_untitled_banner.jpg');
});

// ---- driveImageUrl
test('driveImageUrl produces the public lh3 URL format from the contract', () => {
  assert.equal(
    driveImageUrl('1abcXYZ'),
    'https://lh3.googleusercontent.com/d/1abcXYZ',
  );
});

// ---- formatContentDate
test('formatContentDate produces "Month D, YYYY" from ISO submitted_at', () => {
  assert.equal(formatContentDate('2026-04-27T14:32:11+09:30'), 'April 27, 2026');
  assert.equal(formatContentDate('2026-12-01T00:00:00Z'), 'December 1, 2026');
});

test('formatContentDate uses the date AS-IS from the ISO string (no UTC drift)', () => {
  // Local-time ISO from PWA: 23:00 NT time on Apr 28 should still say "April 28"
  assert.equal(formatContentDate('2026-04-28T23:00:00+09:30'), 'April 28, 2026');
});

test('formatContentDate returns empty string for malformed input', () => {
  assert.equal(formatContentDate(''), '');
  assert.equal(formatContentDate('not a date'), '');
  assert.equal(formatContentDate(null), '');
});

// ---- normaliseText
test('normaliseText trims and CRLF-normalises', () => {
  assert.equal(normaliseText('  hello\r\nworld  '), 'hello\nworld');
});

test('normaliseText handles null/undefined gracefully', () => {
  assert.equal(normaliseText(null), '');
  assert.equal(normaliseText(undefined), '');
});

// ---- extractBodyIndex
test('extractBodyIndex parses the numeric index from body-N.{ext}', () => {
  assert.equal(extractBodyIndex('body-1.jpg'), 1);
  assert.equal(extractBodyIndex('body-12.png'), 12);
});

test('extractBodyIndex returns 0 for non-matching filenames', () => {
  assert.equal(extractBodyIndex('banner.jpg'), 0);
  assert.equal(extractBodyIndex('foo'), 0);
  assert.equal(extractBodyIndex(null), 0);
});

// ---- nextContentNumberFromColumnA
test('nextContentNumberFromColumnA returns max + 1', () => {
  const rows = [['ContentNumber'], ['1'], ['5'], ['3']];
  assert.equal(nextContentNumberFromColumnA(rows), 6);
});

test('nextContentNumberFromColumnA returns 1 for empty data area', () => {
  assert.equal(nextContentNumberFromColumnA([['ContentNumber']]), 1);
  assert.equal(nextContentNumberFromColumnA([]), 1);
  assert.equal(nextContentNumberFromColumnA(null), 1);
});

test('nextContentNumberFromColumnA tolerates non-numeric cells', () => {
  const rows = [['ContentNumber'], ['1'], ['oops'], ['3'], ['']];
  assert.equal(nextContentNumberFromColumnA(rows), 4);
});

test('nextContentNumberFromColumnA never renumbers (matches contract §7 append-only)', () => {
  // Even with a gap (1, 2, 7), the next value is 8 — never compacted to 4.
  const rows = [['ContentNumber'], ['1'], ['2'], ['7']];
  assert.equal(nextContentNumberFromColumnA(rows), 8);
});

// ---- Row builders
test('buildManagerRow produces 10 cells in column order A..J', () => {
  const row = buildManagerRow({
    contentNumber: 5,
    contentDate: 'April 27, 2026',
    title: 'Test',
    description: 'Body text.',
    highlight: 'Hook',
    finalUrl: 'https://x;https://y',
    leaderPhoto: 'https://x',
    submittedBy: 'Duane Kuru',
    status: 'Waiting Approval',
    adminNote: 'cleaned 3 fillers',
  });
  assert.equal(row.length, 10);
  assert.deepEqual(row, [
    5,
    'April 27, 2026',
    'Test',
    'Body text.',
    'Hook',
    'https://x;https://y',
    'https://x',
    'Duane Kuru',
    'Waiting Approval',
    'cleaned 3 fillers',
  ]);
});

test('buildManagerRow defaults adminNote to empty string when not provided', () => {
  const row = buildManagerRow({
    contentNumber: 1,
    contentDate: '',
    title: '',
    description: '',
    highlight: '',
    finalUrl: '',
    leaderPhoto: '',
    submittedBy: '',
    status: '',
  });
  assert.equal(row[9], '');
});

test('buildModalStoriesRow produces 11 cells in column order A..K', () => {
  const row = buildModalStoriesRow({
    contentNumber: 3,
    contentDate: 'April 27, 2026',
    title: 'T',
    description: 'D',
    highlight: 'H',
    finalUrl: 'https://body1;https://body2',
    leaderPhoto: 'https://banner',
    photoTitles: '',
    submittedBy: 'Duane Kuru',
    status: 'Waiting Approval',
    adminNote: '',
  });
  assert.equal(row.length, 11);
  // Column order matters — col F = body URLs, col G = banner URL
  assert.equal(row[5], 'https://body1;https://body2');
  assert.equal(row[6], 'https://banner');
  assert.equal(row[7], ''); // PhotoTitles
});

test('buildHeroContentRow produces 7 cells in column order A..G', () => {
  const row = buildHeroContentRow({
    slideNumber: 5,
    title: 'Test',
    subtitle: 'Hook',
    finalUrl: 'https://banner',
    shrink: 1,
    darkText: 'No',
    status: 'Waiting Approval',
  });
  assert.equal(row.length, 7);
  assert.deepEqual(row, [5, 'Test', 'Hook', 'https://banner', 1, 'No', 'Waiting Approval']);
});

test('buildHeroContentRow defaults Shrink to 1 and DarkText to "No"', () => {
  const row = buildHeroContentRow({
    slideNumber: 5,
    title: 'Test',
    subtitle: 'Hook',
    finalUrl: 'https://banner',
    status: 'Waiting Approval',
  });
  assert.equal(row[4], 1);
  assert.equal(row[5], 'No');
});

// ---- rowToCellData
test('rowToCellData maps numbers to numberValue and strings to stringValue', () => {
  const out = rowToCellData([5, 'hello', '', null, undefined, 0]);
  assert.deepEqual(out[0], { userEnteredValue: { numberValue: 5 } });
  assert.deepEqual(out[1], { userEnteredValue: { stringValue: 'hello' } });
  assert.deepEqual(out[2], { userEnteredValue: { stringValue: '' } });
  assert.deepEqual(out[3], { userEnteredValue: { stringValue: '' } });
  assert.deepEqual(out[4], { userEnteredValue: { stringValue: '' } });
  // 0 is a valid number, not empty
  assert.deepEqual(out[5], { userEnteredValue: { numberValue: 0 } });
});

test('rowToCellData stringifies non-numeric numbers (NaN, Infinity)', () => {
  const out = rowToCellData([NaN, Infinity, -Infinity]);
  // Non-finite numbers fall to stringValue path
  assert.equal(out[0].userEnteredValue.stringValue, 'NaN');
});

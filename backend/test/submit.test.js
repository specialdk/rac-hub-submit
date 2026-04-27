import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ALLOWED_DESTINATIONS,
  TEXT_MIN,
  TEXT_MAX,
  MAX_TOTAL_BYTES,
  hashPin,
  slugifyName,
  buildFolderBaseName,
  detectImageType,
  mimeFor,
  cleanText,
  buildSubmissionJson,
} from '../submit.js';

// ---- constants
test('destination list matches the brief, in order, with General first', () => {
  assert.deepEqual(ALLOWED_DESTINATIONS, [
    'General',
    'CEO Messages',
    'Business Messages',
    'Operations Messages',
    'Community Messages',
    'Safety Messages',
  ]);
});

test('text length bounds match contract', () => {
  assert.equal(TEXT_MIN, 10);
  assert.equal(TEXT_MAX, 1000);
});

test('total upload cap is 20 MB', () => {
  assert.equal(MAX_TOTAL_BYTES, 20 * 1024 * 1024);
});

// ---- hashPin
test('hashPin returns sha256: prefixed hex of the PIN', () => {
  const expected = 'sha256:' + crypto.createHash('sha256').update('1234').digest('hex');
  assert.equal(hashPin('1234'), expected);
});

test('hashPin is deterministic for the same PIN', () => {
  assert.equal(hashPin('5678'), hashPin('5678'));
});

test('hashPin differs for different PINs', () => {
  assert.notEqual(hashPin('1111'), hashPin('1112'));
});

// ---- slugifyName
test('slugifyName lowercases and hyphenates', () => {
  assert.equal(slugifyName('Rachael Schofield'), 'rachael-schofield');
});

test('slugifyName collapses runs of non-alphanumerics', () => {
  assert.equal(slugifyName("Mary-Anne O'Neill"), 'mary-anne-o-neill');
});

test('slugifyName strips diacritics', () => {
  assert.equal(slugifyName('Renée Müller'), 'renee-muller');
});

test('slugifyName trims leading/trailing hyphens', () => {
  assert.equal(slugifyName('  --Duane!!--  '), 'duane');
});

test('slugifyName empty input becomes empty string', () => {
  assert.equal(slugifyName(''), '');
  assert.equal(slugifyName(null), '');
  assert.equal(slugifyName(undefined), '');
});

// ---- buildFolderBaseName
test('buildFolderBaseName uses local wall-clock date and time from ISO string', () => {
  const got = buildFolderBaseName('2026-04-27T14:32:11+09:30', 'Rachael Schofield');
  assert.equal(got, '2026-04-27_14-32_rachael-schofield');
});

test('buildFolderBaseName ignores seconds and offset', () => {
  const got = buildFolderBaseName('2026-12-31T23:59:00-08:00', 'Duane Kuru');
  assert.equal(got, '2026-12-31_23-59_duane-kuru');
});

test('buildFolderBaseName falls back to "unknown" if name slugifies to empty', () => {
  const got = buildFolderBaseName('2026-04-27T14:32:00+00:00', '!!!');
  assert.equal(got, '2026-04-27_14-32_unknown');
});

test('buildFolderBaseName throws on malformed timestamp', () => {
  assert.throws(() => buildFolderBaseName('not-a-date', 'X'), /INVALID_SUBMITTED_AT/);
  assert.throws(() => buildFolderBaseName('', 'X'), /INVALID_SUBMITTED_AT/);
  assert.throws(() => buildFolderBaseName(undefined, 'X'), /INVALID_SUBMITTED_AT/);
});

// ---- detectImageType
test('detectImageType recognises JPEG magic bytes', () => {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectImageType(buf), 'jpg');
});

test('detectImageType recognises PNG magic bytes', () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageType(buf), 'png');
});

test('detectImageType recognises WebP magic bytes', () => {
  const buf = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00, // size (don't care)
    0x57, 0x45, 0x42, 0x50, // WEBP
  ]);
  assert.equal(detectImageType(buf), 'webp');
});

test('detectImageType returns null for unknown formats', () => {
  assert.equal(detectImageType(Buffer.from('GIF89a' + '\0\0\0\0\0\0')), null);
  assert.equal(detectImageType(Buffer.from('not an image at all')), null);
});

test('detectImageType returns null for too-short buffers', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImageType(null), null);
  assert.equal(detectImageType(undefined), null);
});

// ---- mimeFor
test('mimeFor maps known extensions', () => {
  assert.equal(mimeFor('jpg'), 'image/jpeg');
  assert.equal(mimeFor('png'), 'image/png');
  assert.equal(mimeFor('webp'), 'image/webp');
});

test('mimeFor falls back to octet-stream for unknown', () => {
  assert.equal(mimeFor('gif'), 'application/octet-stream');
  assert.equal(mimeFor(''), 'application/octet-stream');
});

// ---- cleanText
test('cleanText trims surrounding whitespace', () => {
  assert.equal(cleanText('   hello  \n'), 'hello');
});

test('cleanText normalizes CRLF to LF', () => {
  assert.equal(cleanText('a\r\nb\r\nc'), 'a\nb\nc');
});

test('cleanText preserves internal whitespace', () => {
  assert.equal(cleanText('  one  two   three  '), 'one  two   three');
});

test('cleanText handles null/undefined gracefully', () => {
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
});

// ---- buildSubmissionJson
test('buildSubmissionJson produces the contract §4 shape', () => {
  const json = buildSubmissionJson({
    submitterName: 'Rachael Schofield',
    pin: '1234',
    destination: 'General',
    submittedAt: '2026-04-27T14:32:11+09:30',
    text: 'A great story about something.',
    titleSuggestion: null,
    highlightSuggestion: null,
    bannerFilename: 'banner.jpg',
    bodyFilenames: ['body-1.jpg', 'body-2.jpg'],
  });

  assert.equal(json.schema_version, '1.0');
  assert.equal(json.submitter_name, 'Rachael Schofield');
  assert.match(json.submitter_pin_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(json.destination, 'General');
  assert.equal(json.submitted_at, '2026-04-27T14:32:11+09:30');
  assert.equal(json.text, 'A great story about something.');
  assert.equal(json.title_suggestion, null);
  assert.equal(json.highlight_suggestion, null);
  assert.equal(json.banner_image, 'banner.jpg');
  assert.deepEqual(json.body_images, ['body-1.jpg', 'body-2.jpg']);
});

test('buildSubmissionJson preserves explicit title/highlight when provided', () => {
  const json = buildSubmissionJson({
    submitterName: 'X',
    pin: '0000',
    destination: 'Safety Messages',
    submittedAt: '2026-04-27T08:00:00+09:30',
    text: 'short text here ok',
    titleSuggestion: 'Custom title',
    highlightSuggestion: 'Custom highlight!',
    bannerFilename: 'banner.png',
    bodyFilenames: [],
  });
  assert.equal(json.title_suggestion, 'Custom title');
  assert.equal(json.highlight_suggestion, 'Custom highlight!');
  assert.equal(json.banner_image, 'banner.png');
  assert.deepEqual(json.body_images, []);
});

test('buildSubmissionJson coerces empty/undefined suggestions to null', () => {
  const json = buildSubmissionJson({
    submitterName: 'X',
    pin: '0000',
    destination: 'General',
    submittedAt: '2026-04-27T08:00:00+09:30',
    text: 'short text here ok',
    titleSuggestion: undefined,
    highlightSuggestion: undefined,
    bannerFilename: 'banner.jpg',
    bodyFilenames: [],
  });
  assert.equal(json.title_suggestion, null);
  assert.equal(json.highlight_suggestion, null);
});

test('buildSubmissionJson never emits raw PIN', () => {
  const json = buildSubmissionJson({
    submitterName: 'X',
    pin: '987654',
    destination: 'General',
    submittedAt: '2026-04-27T08:00:00+09:30',
    text: 'short text here ok',
    titleSuggestion: null,
    highlightSuggestion: null,
    bannerFilename: 'banner.jpg',
    bodyFilenames: [],
  });
  const serialised = JSON.stringify(json);
  assert.equal(serialised.includes('987654'), false);
  // The hash field is the only place a PIN-derived value appears
  assert.match(json.submitter_pin_hash, /^sha256:[0-9a-f]{64}$/);
});

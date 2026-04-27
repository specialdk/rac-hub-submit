import crypto from 'node:crypto';

// Contract §1 / brief: hardcoded destination list, in this order.
export const ALLOWED_DESTINATIONS = [
  'General',
  'CEO Messages',
  'Business Messages',
  'Operations Messages',
  'Community Messages',
  'Safety Messages',
];

// Contract §6 validation thresholds
export const TEXT_MIN = 10;
export const TEXT_MAX = 1000;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

// PIN is hashed with SHA-256 and prefixed `sha256:` before being written
// to submission.json. Raw PIN must never reach Drive (contract §4 / brief).
export function hashPin(pin) {
  const hex = crypto.createHash('sha256').update(pin).digest('hex');
  return `sha256:${hex}`;
}

// Slugify the submitter name for use in the submission folder name.
// Lowercase, strip diacritics, collapse non-alphanumeric runs to single
// hyphens, trim leading/trailing hyphens.
export function slugifyName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Build the submission folder base name per contract §3:
//   `{ISO-date}_{HH-MM}_{slugified-submitter-name}`
// The date and time are taken from the submitter's local wall clock as
// captured at submit-tap (the ISO string includes a TZ offset). We parse
// them out of the string directly instead of via Date(), so the folder
// name reflects the staff member's local time, not UTC.
export function buildFolderBaseName(submittedAtIso, submitterName) {
  const m = (submittedAtIso || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) {
    throw new Error('INVALID_SUBMITTED_AT');
  }
  const date = m[1];
  const hh = m[2];
  const mm = m[3];
  const slug = slugifyName(submitterName) || 'unknown';
  return `${date}_${hh}-${mm}_${slug}`;
}

// Detect image format from the file's first bytes. Returns 'jpg', 'png',
// 'webp', or null if unrecognised. Magic bytes are more reliable than
// trusting Content-Type from a phone — we don't trust the client.
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }
  // WebP: 'RIFF' (4 bytes) + size (4 bytes) + 'WEBP' (4 bytes)
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function mimeFor(ext) {
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Lightweight cleanup of submitter-supplied text: normalize CRLF -> LF,
// trim outer whitespace. The contract calls for "smart quotes" cleanup
// too, but that's the skill's job before writing to the sheet — the JSON
// stored in Drive should preserve what the submitter typed.
export function cleanText(text) {
  return (text ?? '').replace(/\r\n/g, '\n').trim();
}

// Build the submission.json content per contract §4. Caller passes the
// authenticated submitter name (resolved from PIN via Sheet lookup).
export function buildSubmissionJson({
  submitterName,
  pin,
  destination,
  submittedAt,
  text,
  titleSuggestion,
  highlightSuggestion,
  bannerFilename,
  bodyFilenames,
}) {
  return {
    schema_version: '1.0',
    submitter_name: submitterName,
    submitter_pin_hash: hashPin(pin),
    destination,
    submitted_at: submittedAt,
    text,
    title_suggestion: titleSuggestion ?? null,
    highlight_suggestion: highlightSuggestion ?? null,
    banner_image: bannerFilename,
    body_images: bodyFilenames,
  };
}

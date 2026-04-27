// Writes small test images with valid magic bytes for /submit smoke tests.
// These are not real renderable images — just enough to pass detectImageType
// and verify the upload pipeline. Production traffic comes from the PWA which
// produces actual JPEGs.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));

// JPEG magic bytes + 1 KB of zero padding
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(1024),
  Buffer.from([0xff, 0xd9]), // EOI
]);

// PNG magic bytes + small junk
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512),
]);

// A buffer that is NOT a valid image
const garbage = Buffer.from('this is not an image at all, it is plain text\n');

fs.writeFileSync(path.join(dir, 'test-banner.jpg'), jpeg);
fs.writeFileSync(path.join(dir, 'test-body-1.jpg'), jpeg);
fs.writeFileSync(path.join(dir, 'test-body-2.png'), png);
fs.writeFileSync(path.join(dir, 'test-garbage.jpg'), garbage);

console.log('wrote 4 fixture files in', dir);

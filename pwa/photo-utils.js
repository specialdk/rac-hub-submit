/* Photo processing for the PWA.
   Resizes images to a max edge length, applies EXIF orientation by
   rotating the actual canvas pixels, and re-encodes as JPEG. The output
   has no EXIF metadata at all — canvas.toBlob exports raw bitmap data
   only — so GPS coordinates and other camera metadata are dropped.

   Why we do this client-side:
   - Phones lie about orientation in metadata; the Intranet doesn't read
     EXIF, so a sideways-encoded photo would render sideways
   - Resizing to ≤1920px caps the upload size and matches the screen
     resolution the Hub actually displays at
   - Stripping EXIF protects submitter privacy (location data leaks)
*/

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.85;

/* Read the EXIF orientation tag from a JPEG. Returns 1 (no rotation) if
   the file isn't a JPEG, has no EXIF, or the orientation tag is missing.

   Layout of a JPEG with EXIF (relevant bits):
     0xFFD8                          SOI marker
     0xFFE1, len, "Exif\0\0"         APP1 segment containing TIFF
     II|MM 0x002A nextIfdOffset       TIFF header (endian + magic + IFD0 offset)
     entryCount                      IFD0 entry count
     entries[]                       12 bytes each: tag(2) type(2) count(4) value(4)
   The orientation tag is 0x0112 with type SHORT (3) and count 1, so the
   2-byte value lives in the first 2 bytes of the entry's value field. */
async function readExifOrientation(file) {
  if (!file || !file.type || !file.type.startsWith('image/jpeg')) return 1;
  // Orientation lives near the start; reading 256 KB is plenty.
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const view = new DataView(buf);
  if (view.byteLength < 4) return 1;
  if (view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      // APP1 segment — the EXIF container
      const segLen = view.getUint16(offset + 2);
      const segEnd = offset + 2 + segLen;
      // "Exif\0\0" follows the length field
      if (
        view.getUint8(offset + 4) !== 0x45 || // E
        view.getUint8(offset + 5) !== 0x78 || // x
        view.getUint8(offset + 6) !== 0x69 || // i
        view.getUint8(offset + 7) !== 0x66 || // f
        view.getUint8(offset + 8) !== 0x00 ||
        view.getUint8(offset + 9) !== 0x00
      ) {
        offset = segEnd;
        continue;
      }
      const tiffStart = offset + 10;
      const endian = view.getUint16(tiffStart);
      const little = endian === 0x4949;
      // Magic 0x002A confirms TIFF
      if (view.getUint16(tiffStart + 2, little) !== 0x002a) return 1;
      const ifd0Offset = view.getUint32(tiffStart + 4, little);
      const ifd0 = tiffStart + ifd0Offset;
      if (ifd0 + 2 > view.byteLength) return 1;
      const numEntries = view.getUint16(ifd0, little);
      for (let i = 0; i < numEntries; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        const tag = view.getUint16(entry, little);
        if (tag === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          // Sanity-check — orientation is 1..8
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) return 1; // not a marker — bail
    // Skip this segment
    const segLen = view.getUint16(offset + 2);
    if (segLen < 2) return 1;
    offset += 2 + segLen;
  }
  return 1;
}

/* Apply the EXIF orientation transform to a canvas context. The canvas
   is sized at the *displayed* dimensions (after orientation is applied).
   The matrix entries below are the canonical EXIF→canvas transforms.
   Source: image-orientation-fix patterns documented across browser specs
   and the Mozilla developer docs. */
function applyOrientation(ctx, orientation, dispW, dispH) {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, dispW, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, dispW, dispH);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, dispH);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, dispW, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, dispW, dispH);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, dispH);
      break;
    default:
      // 1 = no transform
      break;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

/* Process one image: resize to ≤MAX_EDGE on the longest side (no upscale),
   apply EXIF rotation if needed, re-encode as JPEG, return a Blob with no
   metadata. The Blob's name is set so FormData picks up a sensible default. */
async function processImage(file) {
  const orientation = await readExifOrientation(file);
  const img = await loadImage(file);

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (!srcW || !srcH) throw new Error('Image has zero dimensions');

  // Orientations 5-8 swap the displayed width and height
  const swap = orientation >= 5 && orientation <= 8;
  const dispW = swap ? srcH : srcW;
  const dispH = swap ? srcW : srcH;

  // Scale down so the longest displayed edge fits in MAX_EDGE; never upscale
  const longest = Math.max(dispW, dispH);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  const outW = Math.max(1, Math.round(dispW * scale));
  const outH = Math.max(1, Math.round(dispH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Better quality on downscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  applyOrientation(ctx, orientation, outW, outH);
  // After applyOrientation, the coordinate system is in source-image space.
  // For swapped orientations, the source dims align with (outH, outW).
  if (swap) {
    ctx.drawImage(img, 0, 0, outH, outW);
  } else {
    ctx.drawImage(img, 0, 0, outW, outH);
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });

  return blob;
}

/* Public API attached to window so app.js (non-module script) can use it. */
window.RAC_PHOTOS = {
  MAX_EDGE,
  JPEG_QUALITY,
  readExifOrientation,
  processImage,
};

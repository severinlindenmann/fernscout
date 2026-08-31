/**
 * Perceptual hashing, for the second time you drag the same folder in.
 *
 * You will re-import. The card gets copied to the laptop twice, `osxphotos`
 * runs again with a wider date range, a friend AirDrops you the shots you
 * already have. The exact-bytes check (SHA-256) catches the first case; the
 * difference hash catches the rest, where the pixels are the same photograph
 * but the file is a different export.
 *
 * dHash rather than a DCT hash: it is six lines, it has no false sense of
 * precision, and it is robust to exactly the transformations that matter here
 * — re-encoding, resizing and small quality changes. It is *not* robust to
 * crops or rotation, which is correct: a cropped version is a different photo
 * and you probably want both.
 */
import crypto from "node:crypto";
import fs from "node:fs";

/** The grid dHash compares: one extra column, so 9×8 gives 64 comparisons. */
export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/**
 * 64-bit difference hash of a 9×8 greyscale bitmap, as 16 hex characters.
 *
 * Each bit says "this pixel is brighter than the one to its right", which
 * survives every uniform change to brightness or scale.
 */
export function dHash(gray: Uint8Array): string {
  if (gray.length < DHASH_WIDTH * DHASH_HEIGHT) {
    throw new Error(`dHash needs a ${DHASH_WIDTH}x${DHASH_HEIGHT} greyscale bitmap.`);
  }
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      const at = y * DHASH_WIDTH + x;
      nibble = (nibble << 1) | (gray[at] > gray[at + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

const BIT_COUNT = Array.from({ length: 16 }, (_, i) => (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1));

/** How many of the 64 bits differ. 0 means "the same picture". */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += BIT_COUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return total;
}

/**
 * Bits that may differ before two photos are still called the same one.
 *
 * Three is deliberately tight. The cost of being wrong is asymmetric: a
 * missed duplicate is a second copy in the gallery that you delete in ten
 * seconds, while a false positive silently drops a photograph you will never
 * know was there. Burst frames are genuinely different pictures and land well
 * above this.
 */
export const DUPLICATE_THRESHOLD = 3;

export function isDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= DUPLICATE_THRESHOLD;
}

/** Exact-bytes identity, for the common "same file again" case. */
export function contentHash(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/** How much of a large file the sampled hash reads from each end. */
const SAMPLE_BYTES = 1024 * 1024;

/**
 * Identity for a file too big to read twice — video.
 *
 * Size, plus a megabyte from each end. Pushing 200 MB of 4K through SHA-256
 * on a laptop in a hostel is a second of fan noise for no gain: two different
 * clips agreeing on their length *and* their first and last megabyte does not
 * happen, and unlike name-and-size this survives the folder being moved or
 * renamed, which is what makes a re-import a no-op.
 */
export function sampledFileHash(file: string): string {
  const handle = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(handle).size;
    const digest = crypto.createHash("sha256").update(`${size}`);
    const buffer = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    digest.update(buffer);
    if (size > SAMPLE_BYTES) {
      const tail = Buffer.alloc(Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES));
      fs.readSync(handle, tail, 0, tail.length, size - tail.length);
      digest.update(tail);
    }
    return digest.digest("hex").slice(0, 32);
  } finally {
    fs.closeSync(handle);
  }
}

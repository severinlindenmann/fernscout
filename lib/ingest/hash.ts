/**
 * Perceptual hashing, for the second time you drag the same folder in.
 *
 * You will re-import. The card gets copied to the laptop twice, `osxphotos`
 * runs again with a wider date range, a friend AirDrops you the shots you
 * already have. The exact-bytes check (SHA-256) catches the first case; the
 * difference hash catches the rest, where the pixels are the same photograph
 * but the file is a different export.
 *
 * dHash rather than a DCT hash: it is a dozen lines, it has no false sense of
 * precision, and it is robust to exactly the transformations that matter here
 * — re-encoding, resizing and small quality changes. It is *not* robust to
 * crops or rotation, which is correct: a cropped version is a different photo
 * and you probably want both.
 *
 * **Two axes, and a floor under both** — B872. The hash used to be horizontal
 * only: each bit said "brighter than the pixel to its right", so a picture
 * with no left-to-right variation hashed to all zeros. A plain wall, fog, a
 * whiteout, a shot into the sun, a sky that grades from top to bottom — every
 * one of them came out `0000000000000000`, at distance 0 from every other, and
 * the API's upload path silently dropped the second as a duplicate of the
 * first. Thirty-eight photographs went that way in one afternoon on the live
 * instance. So: a vertical hash beside the horizontal one, both required to
 * agree, and a match refused outright unless at least one axis carries enough
 * set bits to be evidence of anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * The greyscale grid both hashes read: 9×9.
 *
 * Square rather than 9×8, because the vertical hash needs the extra row for
 * the same reason the horizontal one needs the extra column — 8×8
 * comparisons per axis, 64 bits each.
 */
export const DHASH_GRID = 9;

/** Hex characters in a whole hash: 16 for each axis. */
const HASH_HEX = 32;

function hex64(bit: (index: number) => boolean): string {
  let out = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (bit(i + j) ? 1 : 0);
    out += nibble.toString(16);
  }
  return out;
}

/**
 * Two 64-bit difference hashes of a 9×9 greyscale bitmap, as 32 hex characters.
 *
 * The first sixteen say "this pixel is brighter than the one to its right",
 * the second sixteen "…than the one below it". Both survive every uniform
 * change to brightness or scale; neither survives a picture that is flat along
 * its own axis, which is what the other one is for.
 *
 * The length check is exact rather than "at least", and that is deliberate:
 * a bitmap that arrives longer than the grid is a bitmap with channels
 * interleaved into it, and reading the first 81 bytes of one produces a
 * confident hash of nothing. Throwing sends the caller down the unhashable
 * path, where the file goes in unchecked.
 */
export function dHash(gray: Uint8Array): string {
  if (gray.length !== DHASH_GRID * DHASH_GRID) {
    throw new Error(
      `dHash needs exactly a ${DHASH_GRID}x${DHASH_GRID} single-channel greyscale bitmap, got ${gray.length} bytes.`,
    );
  }
  const at = (i: number) => ((i >> 3) & 7) * DHASH_GRID + (i & 7);
  return (
    hex64((i) => gray[at(i)] > gray[at(i) + 1]) + hex64((i) => gray[at(i)] > gray[at(i) + DHASH_GRID])
  );
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

function popCount(hash: string): number {
  let total = 0;
  for (let i = 0; i < hash.length; i++) total += BIT_COUNT[parseInt(hash[i], 16)];
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

/**
 * Set bits one axis needs before a match on it means anything — B872.
 *
 * Eight of 64, and the number comes out of `DUPLICATE_THRESHOLD` rather than
 * out of taste. An axis with three or fewer set bits is within the threshold
 * of the all-zero hash, so it matches *every* other near-empty axis without
 * having agreed about a single pixel. At eight, two axes that match within
 * three bits must share at least five set bits, and five bits of shared
 * structure is evidence rather than an absence.
 *
 * The mirror at the top end counts too, and that is the half easy to miss:
 * all-ones means "every pixel is brighter than its neighbour", which is what
 * *any* smooth gradient says. Two unrelated sunsets both hash to `ffff…` on
 * one axis. So signal is a middling popcount, not a large one.
 */
const MIN_SIGNAL_BITS = 8;

function hasSignal(axis: string): boolean {
  const bits = popCount(axis);
  return bits >= MIN_SIGNAL_BITS && bits <= 64 - MIN_SIGNAL_BITS;
}

/**
 * Two pictures the same, on the evidence available.
 *
 * Both axes have to agree, and at least one of them has to have said
 * something. A picture flat in both directions — a plain wall, a whiteout —
 * therefore matches nothing at all, which is the right answer: it is not
 * that it resembles every other flat picture, it is that a difference hash
 * has no opinion about it. The caller treats that as unhashable and lets the
 * file through, exactly as it does when the hash cannot be computed.
 *
 * A hash of the wrong length is never a duplicate. That covers a `.ingest.json`
 * written before this change, whose 16-character horizontal-only hashes stop
 * matching anything — a re-import may re-add a photograph nothing else caught,
 * which is the direction this file is willing to be wrong in.
 */
export function isDuplicate(a: string, b: string): boolean {
  if (a.length !== HASH_HEX || b.length !== HASH_HEX) return false;
  let evidence = false;
  for (const cut of [0, 16]) {
    const [x, y] = [a.slice(cut, cut + 16), b.slice(cut, cut + 16)];
    if (hammingDistance(x, y) > DUPLICATE_THRESHOLD) return false;
    if (hasSignal(x) && hasSignal(y)) evidence = true;
  }
  return evidence;
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

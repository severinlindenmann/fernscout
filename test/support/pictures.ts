/**
 * A different photograph every time you ask — B604.
 *
 * Three test files each had their own `jpeg()` painting one flat colour, which
 * made every fixture in them the same photograph at different sizes. That was
 * invisible until the upload path learned to notice a duplicate, at which
 * point a good deal of the suite was asserting that the same picture sent
 * twice is stored twice.
 *
 * Flat blocks on a coarse grid, because that is what a difference hash reads
 * (9×8) and what a JPEG re-encode leaves alone — a fine pattern would be
 * detail the encoder is free to throw away, and these fixtures have to survive
 * being re-encoded. The seed is mixed into every block rather than added to
 * all of them: a difference hash compares each block to its neighbour, so a
 * uniformly brighter picture is the *same* picture to it, by design.
 *
 * Measured over 45 seeds: the closest pair differs in 20 of 64 bits, well
 * clear of `DUPLICATE_THRESHOLD`, and a re-encode at quality 55 differs in
 * none.
 */
import sharp from "sharp";

let painted = 0;

/** Deterministic per (seed, block), and unrelated to its neighbours. */
function blockValue(seed: number, row: number, column: number): number {
  let mixed = (seed * 374761393 + row * 668265263 + column * 2246822519) >>> 0;
  mixed = ((mixed ^ (mixed >>> 13)) * 1274126177) >>> 0;
  return ((mixed ^ (mixed >>> 16)) % 200) + 20;
}

/**
 * One JPEG, unlike every other one this process has painted.
 *
 * Pass `seed` to paint the *same* picture twice on purpose — which is what a
 * duplicate test needs, and the reason it is not simply "call it again".
 */
export async function paintJpeg(width: number, height: number, seed?: number): Promise<Buffer> {
  const used = seed ?? (painted += 1);
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * 8) / height);
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x * 9) / width);
      const value = blockValue(used, row, column);
      const at = (y * width + x) * 3;
      pixels[at] = value;
      pixels[at + 1] = (value + 40) % 256;
      pixels[at + 2] = (value + 90) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

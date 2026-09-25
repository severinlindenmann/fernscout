import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { measureImage } from "@/lib/ingest/imageFacts";

/**
 * `measureImage` — B1865. Synthetic pixels only: what the grid says has to
 * follow from what was drawn, and the same bytes have to measure the same.
 */

/** A flat mid-grey frame: nothing to see anywhere in it. */
async function flat(width = 600, height = 600, shade = 128): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: shade, g: shade, b: shade } } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

/** The same frame with bright deterministic noise painted into its top-left ninth. */
async function noisyCorner(width = 600, height = 600): Promise<Buffer> {
  const tile = Math.floor(width / 3);
  // Blocks, not per-pixel speckle: the measurement runs on a ~300 px
  // downscale, and single-pixel noise averages straight back out of it.
  // A fixed checkerboard rather than Math.random, because the same bytes
  // measuring the same is one of the things asserted below.
  const block = 20;
  const pixels = Buffer.alloc(tile * tile * 3);
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      const shade =
        Math.floor(x / block) % 2 === Math.floor(y / block) % 2 ? 130 : 250;
      const at = (y * tile + x) * 3;
      pixels[at] = shade;
      pixels[at + 1] = shade;
      pixels[at + 2] = shade;
    }
  }
  const noise = await sharp(pixels, { raw: { width: tile, height: tile, channels: 3 } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: noise, top: 0, left: 0 }])
    .jpeg({ quality: 100 })
    .toBuffer();
}

const withoutStamp = (facts: Record<string, unknown>) => ({ ...facts, measuredAt: "" });

describe("measureImage", () => {
  test("a flat grey frame is mid-bright, quiet everywhere and says nothing", async () => {
    const facts = await measureImage(await flat());

    expect(facts.width).toBe(600);
    expect(facts.height).toBe(600);
    expect(facts.brightness).toBeGreaterThan(0.45);
    expect(facts.brightness).toBeLessThan(0.55);
    expect(facts.quietTiles).toHaveLength(9);
    for (const tile of facts.quietTiles) expect(tile).toBeLessThan(0.01);
    expect(facts.entropy).toBeLessThan(1);
    expect(facts.version).toBe(1);
  });

  test("a noisy quadrant is louder than the rest of the frame and lifts its brightness", async () => {
    const calm = await measureImage(await flat());
    const facts = await measureImage(await noisyCorner());

    const [topLeft, ...others] = facts.quietTiles;
    for (const tile of others) expect(topLeft).toBeGreaterThan(tile + 0.05);
    expect(facts.brightness).toBeGreaterThan(calm.brightness);
    expect(facts.entropy).toBeGreaterThan(calm.entropy);
  });

  test("the same bytes measure identically", async () => {
    const bytes = await noisyCorner();
    const first = await measureImage(bytes);
    const second = await measureImage(bytes);

    expect(JSON.stringify(withoutStamp(first))).toBe(JSON.stringify(withoutStamp(second)));
  });

  test("EXIF orientation 6 is reported as the picture is displayed", async () => {
    const bytes = await sharp({
      create: { width: 400, height: 800, channels: 3, background: { r: 10, g: 90, b: 140 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const facts = await measureImage(bytes);

    expect([facts.width, facts.height]).toEqual([800, 400]);
  });
});

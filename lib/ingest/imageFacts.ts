/**
 * What only the pixels can say about a photograph — B1865.
 *
 * The photobook planner already measures everything a filename and a shape can
 * tell it: aspect, orientation, panorama, grouping, the length of a caption.
 * What it cannot see without decoding is how bright a picture is, what colour
 * it mostly is, whether it is sharp, whether it is nearly empty, and which
 * ninth of the frame is quiet enough to carry text. `sharp` answers all of
 * that in milliseconds, but only if somebody asks — so this asks, once, and
 * the caller keeps the answer.
 *
 * Each value, and what it is for:
 *
 *  - `brightness` — mean luminance, 0..1. A cover caption on a white sky needs
 *    dark type; on a night shot it needs light type.
 *  - `dominant` — sharp's dominant colour, for a page background or a mount
 *    that does not fight the picture.
 *  - `sharpness` — higher is crisper. A soft frame is a poor full-bleed.
 *  - `entropy` — how much is going on. Near zero is fog, snow or a wall.
 *  - `quietTiles` — nine numbers, row-major over a 3×3 grid, each the mean
 *    per-channel standard deviation of that tile normalised to 0..1. Low means
 *    flat, which means a caption can sit there. `stats()` is one figure for the
 *    whole image, so this takes a pass per tile — cheap, because it runs on a
 *    ~300 px downscale rather than the original.
 *
 * Every float is rounded to four decimals so the same bytes serialise to the
 * same JSON, which is the whole point of caching them. Nothing reads these
 * yet: no layout rule in `lib/photobook/` consults a single one of them. This
 * module only makes the facts available and cheap.
 */
import sharp from "sharp";
import { MAX_DECODE_PIXELS } from "./image.ts";

/** Longest edge of the downscale the quiet-tile grid is measured on. */
const TILE_SOURCE_EDGE = 300;

export type ImageFacts = {
  width: number;
  height: number;
  brightness: number;
  dominant: { r: number; g: number; b: number };
  sharpness: number;
  entropy: number;
  quietTiles: number[];
  measuredAt: string;
  /** Bump when the arithmetic changes, so cached blocks can be recomputed. */
  version: 1;
};

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export async function measureImage(input: Buffer | string): Promise<ImageFacts> {
  const open = () => sharp(input, { limitInputPixels: MAX_DECODE_PIXELS }).rotate();

  const [meta, stats, small] = await Promise.all([
    open().metadata(),
    open().stats(),
    open()
      .resize(TILE_SOURCE_EDGE, TILE_SOURCE_EDGE, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  // `metadata()` reports the stored pixels, not the displayed ones: an EXIF
  // orientation of 5–8 means the picture is a quarter turn from how it is
  // filed, which is exactly what `rotate()` above puts right for everything
  // else here.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;

  const colour = stats.channels.slice(0, 3);
  const brightness = colour.reduce((sum, c) => sum + c.mean, 0) / colour.length / 255;

  return {
    width,
    height,
    brightness: round(brightness),
    dominant: stats.dominant,
    sharpness: round(stats.sharpness),
    entropy: round(stats.entropy),
    quietTiles: quietTiles(small.data, small.info.width, small.info.height, small.info.channels),
    measuredAt: new Date().toISOString(),
    version: 1,
  };
}

/** Mean per-channel standard deviation of each ninth of the frame, 0..1. */
function quietTiles(data: Buffer, width: number, height: number, channels: number): number[] {
  const bands = Math.min(channels, 3);
  const edge = (n: number, i: number) => Math.round((n * i) / 3);
  const tiles: number[] = [];

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const x0 = edge(width, column);
      const x1 = edge(width, column + 1);
      const y0 = edge(height, row);
      const y1 = edge(height, row + 1);
      const count = (x1 - x0) * (y1 - y0);
      if (count <= 0) {
        tiles.push(0);
        continue;
      }

      const sum = new Array<number>(bands).fill(0);
      const squares = new Array<number>(bands).fill(0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const at = (y * width + x) * channels;
          for (let b = 0; b < bands; b++) {
            const value = data[at + b];
            sum[b] += value;
            squares[b] += value * value;
          }
        }
      }

      let stdev = 0;
      for (let b = 0; b < bands; b++) {
        const mean = sum[b] / count;
        stdev += Math.sqrt(Math.max(0, squares[b] / count - mean * mean));
      }
      tiles.push(round(stdev / bands / 255));
    }
  }

  return tiles;
}

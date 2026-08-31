/**
 * Turning a camera file into something a browser should be given.
 *
 * Four things happen here and each one has a reason:
 *
 *  1. **Orientation is baked in.** A phone writes the sensor's pixels and an
 *     EXIF tag saying "now turn this". Derivatives carry no EXIF, so the
 *     rotation has to be applied to the pixels or every portrait shot lies on
 *     its side.
 *  2. **Nothing is served at full size.** A modern phone photo is 4000 px and
 *     several megabytes; the site never displays more than about 2000.
 *  3. **All metadata is dropped except the colour profile.** This is the
 *     privacy step. A JPEG straight off a phone carries the coordinates of
 *     wherever it was taken, and people photograph their own front door. The
 *     coordinates belong in frontmatter, where the author can see and delete
 *     them — not silently inside a file the whole internet can download. The
 *     ICC profile is kept because dropping it turns a wide-gamut photo into a
 *     lurid one, and a colour profile says nothing about anybody.
 *  4. **HEIC gets a fallback.** See `decodeSource`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { DHASH_HEIGHT, DHASH_WIDTH, dHash } from "./hash.ts";

/** Longest edge of a served derivative. */
export const MAX_EDGE = 2000;

export type DerivativeFormat = "jpeg" | "webp";

export type Derivative = {
  bytes: Buffer;
  width: number;
  height: number;
  format: DerivativeFormat;
};

// ---------------------------------------------------------------------------
// HEIC
// ---------------------------------------------------------------------------

/**
 * External decoders, tried in order, for files sharp cannot open.
 *
 * They all write PNG on purpose: PNG cannot carry EXIF, so the intermediate
 * file has no orientation tag left to apply a second time, and no GPS to
 * accidentally carry forward. The EXIF we want was already read from the
 * original bytes before we got here.
 */
const HEIF_DECODERS: { command: string; args: (input: string, output: string) => string[] }[] = [
  { command: "heif-convert", args: (i, o) => [i, o] },
  { command: "sips", args: (i, o) => ["-s", "format", "png", i, "--out", o] },
  { command: "ffmpeg", args: (i, o) => ["-v", "error", "-y", "-i", i, o] },
];

let heifDecoderChecked = false;
let heifDecoder: (typeof HEIF_DECODERS)[number] | null = null;

function findHeifDecoder() {
  if (heifDecoderChecked) return heifDecoder;
  heifDecoderChecked = true;
  for (const decoder of HEIF_DECODERS) {
    const probe = spawnSync(decoder.command, ["--help"], { stdio: "ignore" });
    if (!probe.error) {
      heifDecoder = decoder;
      break;
    }
  }
  return heifDecoder;
}

export class UndecodableImageError extends Error {
  constructor(file: string, detail: string) {
    super(
      `Could not decode ${path.basename(file)}: ${detail}\n` +
        `  If this is a HEIC from an iPhone, sharp's prebuilt libvips can read the\n` +
        `  container but not HEVC-coded image data (patent licensing), so ingest\n` +
        `  needs one of: heif-convert (brew install libheif / apt install libheif-examples),\n` +
        `  sips (macOS, built in), or ffmpeg 7+.\n` +
        `  Exporting JPEG instead of HEIC also works — see docs/ingest.md.`,
    );
    this.name = "UndecodableImageError";
  }
}

export type DecodedSource = {
  /** A path sharp can definitely open. */
  file: string;
  /** True when the pixels are already the right way up and `rotate()` must
   * not be applied again. */
  alreadyOriented: boolean;
  dispose(): void;
};

/** The 9×8 greyscale grid the difference hash compares — and, incidentally,
 * the cheapest possible proof that a decoder can actually read this file. */
async function greyGrid(file: string): Promise<Uint8Array> {
  const raw = await sharp(file, { failOn: "error" })
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  return new Uint8Array(raw);
}

/**
 * Hands back a file sharp can read, converting first if it cannot.
 *
 * sharp's prebuilt binaries ship libheif with the AV1 decoder but not HEVC,
 * so an iPhone HEIC reports its dimensions happily and then fails on the
 * first pixel. That means "can sharp read this" cannot be answered from
 * metadata — it has to be answered by decoding, which is what the grid does.
 */
export async function decodeSource(file: string): Promise<DecodedSource> {
  let failure: string;
  try {
    await greyGrid(file);
    return { file, alreadyOriented: false, dispose: () => {} };
  } catch (err) {
    failure = (err as Error).message.split("\n").pop() ?? String(err);
  }

  const decoder = findHeifDecoder();
  if (!decoder) throw new UndecodableImageError(file, failure);

  const temp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ingest-")),
    "decoded.png",
  );
  const run = spawnSync(decoder.command, decoder.args(file, temp), { stdio: "ignore" });
  if (run.status !== 0 || !fs.existsSync(temp)) {
    fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    throw new UndecodableImageError(file, `${failure} (${decoder.command} could not convert it)`);
  }

  return {
    file: temp,
    // Every decoder above applies the image's own rotation while converting.
    alreadyOriented: true,
    dispose: () => fs.rmSync(path.dirname(temp), { recursive: true, force: true }),
  };
}

/** Which external HEIC decoder is available, for the CLI's status line. */
export function heifDecoderName(): string | null {
  return findHeifDecoder()?.command ?? null;
}

// ---------------------------------------------------------------------------
// Derivatives
// ---------------------------------------------------------------------------

function oriented(source: DecodedSource) {
  const image = sharp(source.file, { failOn: "error" });
  return source.alreadyOriented ? image : image.rotate();
}

export async function perceptualHash(source: DecodedSource): Promise<string> {
  return dHash(await greyGrid(source.file));
}

/**
 * Longest edge of the *source* file, before any resizing.
 *
 * `makeDerivative` always caps at `MAX_EDGE`, so checking the derivative can
 * never catch an oversized original — by the time one exists, it already
 * fits. This reads only the header, not the pixels, so it is cheap enough to
 * run on every file rather than only the ones that look suspicious.
 */
export async function sourceLongestEdge(source: DecodedSource): Promise<number | undefined> {
  const meta = await sharp(source.file, { failOn: "error" }).metadata();
  if (!meta.width || !meta.height) return undefined;
  return Math.max(meta.width, meta.height);
}

/**
 * The file that actually gets served.
 *
 * `withoutEnlargement` matters more than it looks: a 900 px photo from an old
 * camera stays 900 px rather than being upscaled into a blurry 2000 px file
 * that is four times the size and no better.
 */
export async function makeDerivative(
  source: DecodedSource,
  options: { maxEdge?: number; format?: DerivativeFormat; quality?: number } = {},
): Promise<Derivative> {
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const format = options.format ?? "jpeg";
  const quality = options.quality ?? (format === "webp" ? 80 : 82);

  let pipeline = oriented(source)
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    // Keeps colour honest without keeping anything identifying: this copies
    // the ICC profile and nothing else. No EXIF, no XMP, no GPS.
    .keepIccProfile();

  pipeline =
    format === "webp"
      ? pipeline.webp({ quality })
      : pipeline.jpeg({ quality, mozjpeg: true, progressive: true });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, format };
}

/** Extensions ingest treats as photographs. */
export const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp",
  ".tif",
  ".tiff",
  ".avif",
]);

export function extensionFor(format: DerivativeFormat): string {
  return format === "webp" ? ".webp" : ".jpg";
}

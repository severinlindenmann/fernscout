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
import { DHASH_GRID, dHash } from "./hash.ts";
import { IMAGE_MAX_EDGE } from "../validate/media";

/** Longest edge of a served derivative. */
export const MAX_EDGE = 2000;

/**
 * Sharp's own default is roughly 268 megapixels (0x3FFF²) — generous enough
 * that a crafted file a few kilobytes long can still claim to decode into a
 * gigabyte of raw pixels, paid for on every decode this module does (the
 * duplicate-check grid, the derivative, the HEIC fallback's own read-back).
 * `IMAGE_MAX_EDGE` is already the hard ceiling no instance's `imageEdge`
 * config may widen past (see AGENTS.md), so its square is the backstop here
 * too, independent of whatever a narrower per-instance limit says — B1554.
 */
export const MAX_DECODE_PIXELS = IMAGE_MAX_EDGE * IMAGE_MAX_EDGE;

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

/**
 * Probed once per process, and cached — including the "none of them" answer.
 *
 * That matters on a server: install `libheif-examples` on a box that is
 * already serving and every request keeps using the decoder that was on PATH
 * at boot, or none at all. **Restart the app after installing a decoder.**
 * `docs/runbook.md` names the package beside ffmpeg for the same reason.
 */
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

class UndecodableImageError extends Error {
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

/** The 9×9 greyscale grid the difference hashes compare — and, incidentally,
 * the cheapest possible proof that a decoder can actually read this file. */
async function greyGrid(input: string | Buffer): Promise<Uint8Array> {
  const raw = await sharp(input, { failOn: "error", limitInputPixels: MAX_DECODE_PIXELS })
    .resize(DHASH_GRID, DHASH_GRID, { fit: "fill" })
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

  /**
   * Bound the fallback before it runs, not after — B1554.
   *
   * `greyGrid` above already refuses anything past `MAX_DECODE_PIXELS` that
   * sharp itself would decode, but a HEIC's HEVC payload is exactly what
   * sharp *cannot* decode, so that pixel limit never had a chance to fire —
   * the failure that sent us here is "can't read this", not "too big". sharp
   * can still read the container's *declared* size without touching the
   * pixel data (the same fact the thumbnail check below relies on), so that
   * is checked here, before a shell-out and an uncapped temp file get spent
   * on a fallback certain to be refused once it finishes anyway.
   */
  const declared = await sharp(file).metadata().catch(() => undefined);
  if (declared?.width && declared?.height && declared.width * declared.height > MAX_DECODE_PIXELS) {
    throw new UndecodableImageError(
      file,
      `declares ${declared.width}×${declared.height}, more pixels than this server will decode`,
    );
  }

  const temp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ingest-")),
    "decoded.png",
  );
  const run = spawnSync(decoder.command, decoder.args(file, temp), { stdio: "ignore" });
  if (run.status !== 0 || !fs.existsSync(temp)) {
    fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    throw new UndecodableImageError(file, `${failure} (${decoder.command} could not convert it)`);
  }

  /**
   * The decoder answered — but with the right picture? B869.
   *
   * A HEIC carries an embedded thumbnail beside the photograph, and a decoder
   * that cannot read the HEVC payload can still hand back the thumbnail and
   * exit 0. That is the worst shape a media pipeline has: a 1600×1200
   * photograph replaced by a 512×512 strip of sky, stored, and reported as a
   * `201` with confident dimensions in both `items` and `kept`.
   *
   * sharp reads the container's *declared* size even when it cannot decode a
   * pixel of it, so the two numbers can be compared, and disagreeing is proof
   * that what came back is not this picture. Compared as an unordered pair
   * because every decoder above applies the EXIF rotation, which legitimately
   * swaps the two.
   *
   * Best effort on the declared side only: a file whose header sharp cannot
   * read at all has nothing to check against, and refusing those would refuse
   * formats this has no opinion about.
   */
  const [got, redeclared] = await Promise.all([
    sharp(temp, { limitInputPixels: MAX_DECODE_PIXELS }).metadata().catch(() => undefined),
    sharp(file, { limitInputPixels: MAX_DECODE_PIXELS }).metadata().catch(() => undefined),
  ]);
  const pair = (m?: { width?: number; height?: number }) =>
    m?.width && m.height ? [Math.min(m.width, m.height), Math.max(m.width, m.height)] : undefined;
  const a = pair(redeclared);
  const b = pair(got);
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) {
    fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    throw new UndecodableImageError(
      file,
      `${decoder.command} returned a ${got!.width}×${got!.height} image for a file that ` +
        `declares ${redeclared!.width}×${redeclared!.height}, so what it decoded is not this ` +
        `photograph — most likely the embedded thumbnail, because it could not read the ` +
        `image data itself`,
    );
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
  const image = sharp(source.file, { failOn: "error", limitInputPixels: MAX_DECODE_PIXELS });
  return source.alreadyOriented ? image : image.rotate();
}

export async function perceptualHash(source: DecodedSource): Promise<string> {
  return dHash(await greyGrid(source.file));
}

/**
 * The same hash, taken off bytes already in hand — B872.
 *
 * Which side of the pipeline a picture is hashed on has to match, or nothing
 * compares. The upload path used to hash the *arriving original* and compare
 * it against the *stored derivatives*, and those are not the same picture to a
 * difference hash: the derivative has been rotated upright, capped at
 * `MAX_EDGE` and re-encoded, and on anything finely textured that moves the
 * 9×9 averages by tens of bits. A file uploaded twice therefore failed to
 * match itself. Both sides now hash the derivative.
 */
export async function perceptualHashOf(bytes: Buffer): Promise<string> {
  return dHash(await greyGrid(bytes));
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
  const meta = await sharp(source.file, { failOn: "error", limitInputPixels: MAX_DECODE_PIXELS }).metadata();
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

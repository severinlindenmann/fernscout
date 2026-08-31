/**
 * A day's photographs → an entry you only have to write the words for.
 *
 *   npm run ingest -- --user <username> --trip <tripId> <folder>
 *   npm run ingest -- --user alice --trip patagonia ~/Desktop/day-14 --dry-run
 *
 * The design target is a stopwatch: from `npm run ingest` to a published day
 * in under ten minutes, most of which should be you typing. So there are no
 * prompts, no confirmations and no interactive picker — it makes its best
 * guess about dates, places and grouping, writes files you can edit, and gets
 * out of the way. `--dry-run` shows the plan when you want to look first.
 *
 * Everything it needs is on the disk. There is no network call anywhere in
 * this path, including the reverse geocoding, because the evening you most
 * want to write up the day is the evening the wifi does not work.
 */
import path from "node:path";
import { IngestError, ingest } from "../lib/ingest/index.ts";
import { geodataAvailable } from "../lib/ingest/geo.ts";
import { heifDecoderName } from "../lib/ingest/image.ts";
import { MAX_SECONDS, videoToolsAvailable } from "../lib/ingest/video.ts";

const USAGE = `Usage:
  npm run ingest -- --user <username> --trip <tripId> <folder> [options]

Options:
  --dry-run                 Work everything out, write nothing.
  --force                   Import files even if the trip has seen them before.
  --gap-hours <n>           Hours of silence that start a new entry (default 5).
  --split-km <n>            Distance from a stop's centre that starts a new
                            entry (default 30).
  --max-edge <px>           Longest edge of served images (default 2000).
  --format <jpeg|webp>      Derivative format (default jpeg).
  --quality <n>             Encoder quality (default 82 jpeg / 80 webp).
  --max-video-seconds <n>   Hard cap on clip length (default ${MAX_SECONDS}).
  --tags a,b,c              Tags added to every entry created.
  --tools                   Report which optional tools are available and exit.

Notes files:
  Any .md/.txt in the folder becomes the entry's prose. Name it after the day
  (2026-08-14.md) and it lands on that day's entry.`;

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { flags: Args; positional: string[] } {
  const flags: Args = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { flags, positional };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function text(flags: Args, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function number(flags: Args, key: string): number | undefined {
  const value = text(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`--${key} needs a number, got "${value}".`);
  return parsed;
}

const { flags, positional } = parseArgs(process.argv.slice(2));

if (flags.help || flags.h) {
  console.log(USAGE);
  process.exit(0);
}

if (flags.tools) {
  const heif = heifDecoderName();
  console.log("Ingest tooling:\n");
  console.log(`  ${geodataAvailable() ? "ready      " : "missing    "} offline place index`);
  console.log(`             ${geodataAvailable() ? "reverse geocoding works offline" : "run: npm run build:geodata"}`);
  console.log(`  ${videoToolsAvailable() ? "ready      " : "missing    "} ffmpeg + ffprobe`);
  console.log(`             ${videoToolsAvailable() ? "video clips will be transcoded" : "video clips will be skipped"}`);
  console.log(`  ${heif ? "ready      " : "missing    "} HEIC decoder`);
  console.log(
    `             ${heif ? `${heif} handles what sharp's libvips cannot` : "install libheif or ffmpeg 7+, or export JPEG"}`,
  );
  const moved = process.env.MEDIA_ORIGINALS_DIR?.trim();
  console.log(`  ready       originals are kept`);
  console.log(
    `             ${moved ?? "beside each trip, in originals/ — set MEDIA_ORIGINALS_DIR to move them"}`,
  );
  process.exit(0);
}

const username = text(flags, "user");
const tripId = text(flags, "trip");
const source = positional[0];

if (!username || !tripId || !source) fail(USAGE);

const format = text(flags, "format") ?? "jpeg";
if (format !== "jpeg" && format !== "webp") fail(`--format must be jpeg or webp, got "${format}".`);

const started = Date.now();

try {
  const result = await ingest({
    username,
    tripId,
    source: path.resolve(source),
    dryRun: flags["dry-run"] === true,
    force: flags.force === true,
    gapHours: number(flags, "gap-hours"),
    splitKm: number(flags, "split-km"),
    maxEdge: number(flags, "max-edge"),
    quality: number(flags, "quality"),
    maxVideoSeconds: number(flags, "max-video-seconds"),
    format,
    tags: text(flags, "tags")
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    onProgress: (message) => console.log(message),
  });

  console.log("");
  for (const entry of result.entries) {
    console.log(
      `  ${entry.created ? "new " : "+   "} ${entry.file}` +
        `  (${entry.mediaCount} file${entry.mediaCount === 1 ? "" : "s"}` +
        `${entry.location ? `, ${entry.location}` : ""})`,
    );
  }

  const skippedDuplicates = result.skipped.filter((s) => s.reason !== "no ffmpeg");
  if (skippedDuplicates.length > 0) {
    console.log(`\n  ${skippedDuplicates.length} file(s) already in this trip, left alone.`);
  }

  for (const warning of result.warnings) console.log(`\n  ! ${warning}`);

  for (const failure of result.failed) {
    console.log(`\n  ! ${path.basename(failure.file)}: ${failure.reason}`);
  }

  if (flags["dry-run"] === true) {
    console.log("\n(dry run — nothing was written)");
  } else if (result.entries.length > 0) {
    // The remaining work is prose, so point straight at it.
    console.log(
      `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
        `${result.imported} file(s) imported.\n` +
        `Now write the words: ${result.entries[0].file}\n` +
        `Each new entry is a draft — delete its \`status: draft\` line to publish.`,
    );
  }

  process.exit(result.failed.length > 0 ? 1 : 0);
} catch (err) {
  if (err instanceof IngestError) fail(err.message);
  if (err instanceof Error && "code" in err && err.code === "ENOENT") {
    fail(`Not found: ${(err as NodeJS.ErrnoException).path ?? source}`);
  }
  throw err;
}

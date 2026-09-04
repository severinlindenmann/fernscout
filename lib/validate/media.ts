// Limits on the photographs and clips a day may include.
//
// Pure, like lib/validate/entry.ts: no fs, no decoding, just numbers in and
// problems out. That is what lets ingest check a file before it spends a
// second decoding or transcoding it, and what lets the agent guide quote
// these same numbers instead of retyping them (see lib/api/documentation.ts).
//
// Photographs never arrive through the REST API or MCP (see AGENTS.md — they
// come in through `npm run ingest`), so ingest is this module's one caller
// today. The shape is kept general anyway: a future upload path gets the
// same rules for free instead of a fourth copy.

/** What sharp reads today — see lib/ingest/image.ts. Ingest's own extension
 * list is wider (it also accepts tif/tiff/avif, which sharp happens to open
 * too); this is the smaller, documented set the agent guide promises. */
export const IMAGE_FORMATS = ["jpeg", "png", "heic", "heif", "webp"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** What ffmpeg is asked to produce — see lib/ingest/video.ts. */
export const VIDEO_FORMATS = ["mp4", "mov", "webm"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** A 100-megapixel scan is a mistake, not a photo. */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 8000;

/** A travel journal, not a channel. */
export const VIDEO_MAX_SECONDS = 90;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export const MAX_ITEMS_PER_DAY = 40;

export type Problem = {
  field: string;
  got: string;
  expected: string;
  /** A sentence, for the rare problem where naming the field in `field` is
   * not enough — see the empty-`files` refusal in lib/api/media.ts, which an
   * agent read past once the field name was carried only there (B292). */
  hint?: string;
};

export type MediaCandidate = {
  /** Used only to name the field in a problem — this module never opens the
   * file itself. */
  name: string;
  kind: "image" | "video";
  /**
   * Omit to skip the format check. Ingest already gates on its own, wider
   * extension list before this module ever sees a file (see IMAGE_FORMATS
   * above), so it validates size and dimensions here without asking this
   * module to re-litigate a format ingest has already accepted.
   */
  format?: string;
  bytes?: number;
  /** Longest edge in pixels — images only. */
  longestEdge?: number;
  /** Video only. */
  durationSeconds?: number;
};

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The numbers to judge against.
 *
 * Defaults to the constants above, which is what every caller wanted before
 * they were configurable. An instance passes its own — see lib/mediaLimits.ts
 * and the `media` block in content/config.json.
 */
export type Limits = {
  imageBytes: number;
  imageEdge: number;
  videoBytes: number;
  videoSeconds: number;
  itemsPerDay: number;
};

const BUILT_IN: Limits = {
  imageBytes: IMAGE_MAX_BYTES,
  imageEdge: IMAGE_MAX_EDGE,
  videoBytes: VIDEO_MAX_BYTES,
  videoSeconds: VIDEO_MAX_SECONDS,
  itemsPerDay: MAX_ITEMS_PER_DAY,
};

/** Every limit `item` breaks — the limit and the actual value, in that
 * order, per the acceptance rule in docs/plans/W29-content-validation.md. */
export function validateMediaItem(item: MediaCandidate, limits: Limits = BUILT_IN): Problem[] {
  const problems: Problem[] = [];
  const formats = item.kind === "image" ? IMAGE_FORMATS : VIDEO_FORMATS;
  const maxBytes = item.kind === "image" ? limits.imageBytes : limits.videoBytes;

  if (item.format !== undefined && !(formats as readonly string[]).includes(item.format.toLowerCase())) {
    problems.push({
      field: `${item.name}.format`,
      got: item.format,
      expected: `one of ${formats.join(", ")}`,
    });
  }

  if (item.bytes !== undefined && item.bytes > maxBytes) {
    problems.push({
      field: `${item.name}.size`,
      got: megabytes(item.bytes),
      expected: `at most ${megabytes(maxBytes)}`,
    });
  }

  if (item.kind === "image" && item.longestEdge !== undefined && item.longestEdge > limits.imageEdge) {
    problems.push({
      field: `${item.name}.dimensions`,
      got: `${item.longestEdge}px`,
      expected: `at most ${limits.imageEdge}px on the longest edge`,
    });
  }

  if (
    item.kind === "video" &&
    item.durationSeconds !== undefined &&
    item.durationSeconds > limits.videoSeconds
  ) {
    problems.push({
      field: `${item.name}.duration`,
      got: `${item.durationSeconds.toFixed(0)}s`,
      expected: `at most ${limits.videoSeconds}s`,
    });
  }

  return problems;
}

/**
 * Every item's own problems, plus the batch-level one: more items in this one
 * request than a day may hold at all.
 *
 * **This sentence is about the request; `storeUploads`' ceiling is about the
 * day, and until B209 they were word for word the same** — `at most 40 per
 * day`, with `got` differing only in a trailing phrase. An agent reading the
 * refusal could not tell "send fewer in one call" from "this day is full", and
 * those have different remedies.
 *
 * What is said here has to be careful, because the two are not independent:
 * the day ceiling counts what is on disk *plus* what arrived, so it fires
 * whenever this one does. A batch over the limit therefore cannot be rescued
 * by splitting it — the day could not hold the items either way — and this
 * message must not advise that. It says the items belong on more than one day.
 * See B209, and the capture it references for the redundancy itself.
 */
export function validateMediaBatch(items: MediaCandidate[], limits: Limits = BUILT_IN): Problem[] {
  const problems = items.flatMap((item) => validateMediaItem(item, limits));
  if (items.length > limits.itemsPerDay) {
    problems.push({
      field: "media",
      got: `${items.length} items in one request`,
      expected:
        `at most ${limits.itemsPerDay} items in one request. That is also all one day may ` +
        `hold, so splitting this batch will not help — these belong on more than one day.`,
    });
  }
  return problems;
}

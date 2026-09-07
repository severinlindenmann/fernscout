import { singleLineProblem } from "./frontmatter";
import { PHOTO_VISIBILITIES, type PhotoVisibility } from "../photos";

/**
 * What arrived, rendered for somebody reading a refusal.
 *
 * `describe` in lib/validate/entry.ts is the same three lines, and is
 * deliberately not imported: that module already imports `captionProblem`
 * from this one, and a cycle between two validators is a worse trade than one
 * short function twice.
 */
function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Limits on the photographs and clips a day may include.
//
// Pure, like lib/validate/entry.ts: no fs, no decoding, just numbers in and
// problems out. That is what lets ingest check a file before it spends a
// second decoding or transcoding it, and what lets the agent guide quote
// these same numbers instead of retyping them (see lib/api/documentation.ts).
//
// Photographs never arrive through the REST API (see AGENTS.md — they
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

/**
 * A travel journal, not a channel — but the cap is a backstop and not an
 * editorial opinion.
 *
 * It was 90 seconds, which refused a great many clips people actually had:
 * a phone records until you stop it, and "trim it first" is a sentence with
 * nowhere to go for somebody handing photographs to an agent. Five minutes is
 * long enough that almost nothing real is refused.
 *
 * `VIDEO_SHORT_SECONDS` is the other half, and it is the half that used to be
 * done by refusing. Past it the upload still succeeds and the response says
 * plainly that a short clip is the better thing to put on a day — advice a
 * person can take or ignore, rather than a wall.
 */
export const VIDEO_MAX_SECONDS = 5 * 60;
export const VIDEO_SHORT_SECONDS = 60;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

export const MAX_ITEMS_PER_DAY = 40;

/**
 * The whole request body, which is a different limit from any of the above —
 * B523.
 *
 * This app has a `proxy.ts`, and Next buffers the body of a proxied request in
 * memory so it can be read more than once. Past
 * `experimental.proxyClientMaxBodySize` it does not fail: it **truncates** and
 * logs a warning server-side, and the route's `request.formData()` then cannot
 * parse what is left. Next's default is 10 MB, which is below the ordinary
 * output of a current phone — 15 of 75 photographs in one real import could
 * not be sent at all, and the refusal said `expected_multipart`, which sends
 * the caller to inspect its own Content-Type.
 *
 * So the number is set here rather than left to the default, and
 * `next.config.ts` reads it from this file so the cap and the documentation
 * cannot drift apart.
 *
 * Why 64 MiB and not 200 (`VIDEO_MAX_BYTES`): every byte of it is held in
 * memory before the route sees the request, so this is the one limit whose
 * ceiling is the server's RAM rather than somebody's disk. 64 MiB clears the
 * 50 MB an image may be, with room for the multipart framing around it. A clip
 * larger than this cannot come through the network door at all — `npm run
 * ingest`, which reads a folder on the same machine, has no such ceiling — and
 * the refusal says so rather than leaving it to be discovered.
 */
export const REQUEST_MAX_BYTES = 64 * 1024 * 1024;
/** A caption is one line under a picture; the day's prose is where the rest
 * belongs. Applied on the way in through the media endpoint and again on a
 * `PATCH` that corrects one. B522. */
export const CAPTION_MAX_CHARS = 300;

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
 * and the `media` block in site/config.json.
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

/**
 * Captions off a request, positionally — `captions[n]` describes the n-th file
 * sent, through either door.
 *
 * A caption is the only part of a gallery item a caller supplies: `src`,
 * `width` and `height` are measured off the file, and until the server has
 * named the file there is no key to address it by. So the list runs alongside
 * `files` (or `urls`), and **more captions than files is refused rather than
 * quietly dropped** — the shape that would put somebody's line under the wrong
 * photograph, which is worse than no caption at all. Fewer is fine: most
 * pictures have nothing said about them.
 *
 * Correcting one afterwards is `PATCH .../days/<slug>` with `captions` keyed
 * by `src`, which by then exists. B522.
 */
export function captionsFor(
  raw: unknown,
  count: number,
): { ok: true; captions: string[] } | { ok: false; problem: Problem } {
  if (raw === undefined || raw === null) return { ok: true, captions: [] };
  if (!Array.isArray(raw) || raw.some((caption) => typeof caption !== "string")) {
    return {
      ok: false,
      problem: {
        field: "captions",
        got: "something that is not a list of strings",
        expected: "one caption per file, as strings, in the same order as the files",
      },
    };
  }
  const captions = (raw as string[]).map((caption) => caption.trim());
  if (captions.length > count) {
    return {
      ok: false,
      problem: {
        field: "captions",
        got: `${captions.length} captions for ${count} ${count === 1 ? "file" : "files"}`,
        expected:
          "at most one caption per file, in the same order. Fewer is fine — send an empty " +
          "one, or none at all, for a picture nobody said anything about.",
      },
    };
  }
  for (const caption of captions) {
    const problem = captionProblem(caption, "captions");
    if (problem) return { ok: false, problem };
  }
  return { ok: true, captions };
}

/**
 * `visibility` beside `captions`: one label per file, in the same order — B596.
 *
 * The same list-shaped argument as captions and validated the same way,
 * because a caller sending one is sending both in the same call and should not
 * have to learn two conventions. `null` and `""` both mean "hold nothing
 * back", so a caller filling a slot it has no answer for does not have to
 * invent one.
 *
 * There is no `"public"`, and a caller reaching for it gets that sentence
 * rather than a silent pass: a label narrows what the trip already allows and
 * cannot widen it.
 */
export function visibilitiesFor(
  raw: unknown,
  count: number,
): { ok: true; visibilities: (PhotoVisibility | undefined)[] } | { ok: false; problem: Problem } {
  if (raw === undefined || raw === null) return { ok: true, visibilities: [] };
  const list = Array.isArray(raw) ? raw : null;
  if (!list) {
    return {
      ok: false,
      problem: {
        field: "visibility",
        got: describe(raw),
        expected: `one label per file, in the same order as the files — ${PHOTO_VISIBILITIES.join(
          " or ",
        )}, or null for a picture nobody is holding back`,
      },
    };
  }
  if (list.length > count) {
    return {
      ok: false,
      problem: {
        field: "visibility",
        got: `${list.length} labels for ${count} ${count === 1 ? "file" : "files"}`,
        expected: "at most one label per file, in the same order. Fewer is fine",
      },
    };
  }
  const visibilities: (PhotoVisibility | undefined)[] = [];
  for (const [at, value] of list.entries()) {
    if (value === null || value === undefined || value === "") {
      visibilities.push(undefined);
      continue;
    }
    if (!(PHOTO_VISIBILITIES as readonly unknown[]).includes(value)) {
      return {
        ok: false,
        problem: {
          field: `visibility[${at}]`,
          got: describe(value),
          expected:
            `one of ${PHOTO_VISIBILITIES.join(", ")}, or null. There is no "public" — a ` +
            "label narrows what the trip's own visibility already allows and can never widen it",
        },
      };
    }
    visibilities.push(value as PhotoVisibility);
  }
  return { ok: true, visibilities };
}

/**
 * The two things a caption has to be, wherever it arrives from — the media
 * endpoint on the way in, and a `PATCH` correcting one later.
 *
 * Short, and one line. `quoteScalar` guarantees the file parses whatever it is
 * handed, so neither check is what keeps the day readable; they are here so a
 * caller who sent two lines by accident is told which field is wrong now,
 * rather than finding a caption with a stray `\n` in it on the site. Same
 * pairing, and the same reasoning, as `singleLineProblem` beside a title.
 */
export function captionProblem(caption: string, field: string): Problem | null {
  if (caption.length > CAPTION_MAX_CHARS) {
    return {
      field,
      got: `${caption.length} characters`,
      expected: `at most ${CAPTION_MAX_CHARS} — the day's prose is where the rest belongs`,
    };
  }
  const multiLine = singleLineProblem(field, caption);
  if (multiLine) {
    return { field, got: "more than one line", expected: multiLine };
  }
  return null;
}

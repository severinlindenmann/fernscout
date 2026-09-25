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
type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** What ffmpeg is asked to produce — see lib/ingest/video.ts. */
export const VIDEO_FORMATS = ["mp4", "mov", "webm"] as const;
type VideoFormat = (typeof VIDEO_FORMATS)[number];

/** A 100-megapixel scan is a mistake, not a photo. */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
/**
 * 8000 refused a real 48 MP iPhone photo (8064×6048) at the last step of
 * adding a day — B2179. 12000 covers every current phone sensor with room to
 * spare; `lib/ingest/image.ts`'s `MAX_DECODE_PIXELS` is pinned to a literal
 * so raising this edge does not also raise decode memory.
 */
export const IMAGE_MAX_EDGE = 12000;

/**
 * How many pixels this server will actually decode, independent of
 * `IMAGE_MAX_EDGE` above — B2179. A 9000×9000 image has an edge well under
 * 12000 but is 81 megapixels, more than this server will decode; a thin
 * 20000×500 image is the opposite case. Neither is caught by `IMAGE_MAX_EDGE`
 * alone, and `lib/ingest/image.ts`'s `MAX_DECODE_PIXELS` — every sharp decode
 * in this codebase's `limitInputPixels` — is this same number, so what gets
 * decoded and what this door promises a caller are the one figure, not two
 * that can drift. Published at `/api/health` and `/api/v2/status` as
 * `media.imageMaxPixels`, same reason as every other limit here (AGENTS.md:
 * a limit belongs where a caller can read it before they hit it).
 */
export const IMAGE_MAX_PIXELS = 64_000_000;

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
/**
 * Five hundred megabytes, which is a real clip off a real phone.
 *
 * It was 200 MB, and the number was never the binding one anyway: the request
 * cap below was a third of it, so the honest ceiling on a clip arriving over
 * the network was 64 MB and this constant only described what `npm run ingest`
 * would take off a folder. Both moved together, so the two doors now say the
 * same thing.
 */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;

export const MAX_ITEMS_PER_DAY = 40;

/**
 * How much one journal may hold in the camera-roll import's staging area,
 * across every run it owns — B1807.
 *
 * **Per journal, not per import.** The obvious per-file and per-run ceilings
 * (above) never stopped one owner's staging tree from growing without bound,
 * because staging deliberately sits outside `journalBytes`
 * (`lib/storageQuota.ts`) — see `lib/staging/paths.ts`'s own doc comment on
 * why. `lib/staging/store.ts`'s `journalStagingBytes` sums every run this
 * owner has staged, and that sum — not one run's own bytes — is what this
 * number bounds. A run that is already staged and forgotten still counts:
 * it is the owner's disk either way, and `studio.photos.upload.rejected.overCapacity`
 * is written to say so and point at the runs holding the space.
 *
 * Ten gigabytes, decided by the owner (2026-09-15).
 */
export const JOURNAL_STAGING_MAX_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * The fraction of `JOURNAL_STAGING_MAX_BYTES` above which a storage bar is
 * worth drawing next to B1806's countdown — B1807.
 *
 * Half, not `storageQuota.ts`'s own 90% warn line: that number decides when
 * to *mail* an owner about their real journal, which is a rare, disruptive
 * event worth holding off on. This is a line of pixels on a screen the owner
 * is already looking at mid-import, and the bar's whole job is to explain a
 * refusal *before* it happens rather than only after — which means it has to
 * show up earlier than the point of actual danger, not at it. An import that
 * is a fifth of the way to the ceiling has nothing useful to learn from a
 * bar; one that is half way does.
 */
export const JOURNAL_STAGING_WARN_FRACTION = 0.5;

/**
 * `2.3 GB`, with the decimal point read from the active locale (`,` in
 * German) — a client-safe alternative to `formatBytes` in
 * `lib/storageQuota.ts`, which is `server-only` and, more to the point,
 * never localises its `.` at all. A size sitting next to translated words is
 * exactly the case this repository's own rule about `tn()` and locale-real
 * strings means to cover.
 */
export function formatGigabytes(bytes: number, locale: string): string {
  const gb = bytes / 1024 ** 3;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(gb)} GB`;
}

/**
 * What an import currently weighs, at a unit somebody can read — B1941.
 *
 * `formatGigabytes` is fixed at one decimal because it states the *ceiling*,
 * which is 10 GB and never small. A run is the other end of the scale: the
 * owner's was 18.7 MB and printed as "0,0 GB", which is what every import
 * small enough to finish in one sitting looked like.
 *
 * `formatBytes` in `lib/storageQuota.ts` already scales and is deliberately
 * not reused: it is operator-facing and unlocalised, so it would show a
 * German reader "18.7 MB" with the wrong decimal mark. This is the same
 * arithmetic through `Intl`.
 */
export function formatStagedBytes(bytes: number, locale: string): string {
  if (bytes >= 1024 ** 3) return formatGigabytes(bytes, locale);
  // B2134 — under a megabyte the whole-MB rounding said "0 MB" for 494 KB,
  // which reads as empty. Kilobytes there, never 0 and never 1024.
  if (bytes > 0 && bytes < 1024 ** 2) {
    const kb = Math.min(1023, Math.max(1, Math.round(bytes / 1024)));
    return `${new Intl.NumberFormat(locale).format(kb)} KB`;
  }
  const mb = bytes / 1024 ** 2;
  // Whole megabytes: a tenth of a megabyte is not a number anybody acts on,
  // and "0 MB" for a genuinely tiny run is honest rather than misleading.
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(mb)} MB`;
}

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
 * Why 512 MiB, and what it costs. Every byte of it is held in memory before
 * the route sees the request, so this is the one limit here whose ceiling is
 * the server's RAM rather than somebody's disk — a single upload in flight can
 * be half a gigabyte of it, and two at once a gigabyte. It sits above
 * `VIDEO_MAX_BYTES` deliberately, with room for the multipart framing: a cap
 * below the largest file the same document says is acceptable is a promise the
 * door cannot keep, which is exactly what it was before — clips were advertised
 * at 200 MB and refused at 64. An instance that cannot afford the memory should
 * narrow `media.videoBytes` in its own config (lib/mediaLimits.ts) and tell
 * people to use `npm run ingest`, which reads a folder on the same machine and
 * has no ceiling at all.
 */
export const REQUEST_MAX_BYTES = 512 * 1024 * 1024;
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

/** `70.6`, `64` — one decimal, dropped when it would just be `.0`. */
function megapixels(pixels: number): number {
  return Math.round((pixels / 1_000_000) * 10) / 10;
}

/**
 * The refusal for a header that declares more pixels than `IMAGE_MAX_PIXELS`
 * — B2179 round 2.
 *
 * Distinct from the `.dimensions` problem `validateMediaItem` returns below:
 * that one knows the real longest edge and says so truthfully. This is
 * reached only when a decode-bounded `sharp(...).metadata()` read refused to
 * answer at all, which happens before a real `longestEdge` exists for this
 * module to see — inventing one (`limits.imageEdge + 1`, this code's own
 * first shape) reported a false, and sometimes wrong-shaped, refusal: a
 * 9000×9000 (81 MP) file has an edge under `IMAGE_MAX_EDGE` and would have
 * been reported as passing the edge check while actually failing the pixel
 * one. `actual`, when the caller could re-read the header without the decode
 * limit, is the real width, height and megapixel count; when even that read
 * fails (a header large enough to beat sharp's own generous default ceiling
 * too), the honest answer is "more than", not a number nobody measured.
 */
export function pixelCountProblem(name: string, actual?: { width: number; height: number }): Problem {
  const ceiling = megapixels(IMAGE_MAX_PIXELS);
  return {
    field: `${name}.pixels`,
    got: actual
      ? `${actual.width}×${actual.height} (${megapixels(actual.width * actual.height)} MP)`
      : `more than ${ceiling} MP`,
    expected: `at most ${ceiling} MP`,
  };
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
 * Every item's own problems — format, size, dimensions, duration.
 *
 * There used to be a batch-level problem here too: more items in one request
 * than a day may hold at all. B209 found that its wording was word-for-word
 * `storeUploads`' own day-ceiling refusal (`existing + uploads.length >
 * limits.itemsPerDay`), and B229 found the deeper reason why: `existing` is a
 * count of files already on disk and is never negative, so `items.length >
 * limits.itemsPerDay` on its own is never true without
 * `existing + items.length > limits.itemsPerDay` also being true — including
 * on the first upload of a day, where `existing` is zero and the two
 * conditions coincide exactly. `storeUploads` is this function's only
 * production caller (ingest validates one file at a time, through
 * `validateMediaItem`), so there was no caller for which the request-level
 * rule ever fired on its own: one oversized batch produced two problems about
 * one cause. The day ceiling in `storeUploads` is now the only place a count
 * is judged.
 */
export function validateMediaBatch(items: MediaCandidate[], limits: Limits = BUILT_IN): Problem[] {
  return items.flatMap((item) => validateMediaItem(item, limits));
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

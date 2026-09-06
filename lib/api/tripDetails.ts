import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTrip, tripDir, type TripRef } from "../trips";
import { DATE_RE } from "../tripWrite";
import { spliceScalar } from "../frontmatterScalar";

/**
 * A trip's `title:`, `tagline:`, `start:` and `end:`, after it exists — B621.
 *
 * These four were the last fields of a trip that nothing could write. Every
 * other one got a door as somebody needed it — `visibility` (B396), `rates`
 * (B352), `people`, `travellers`, `tracks` — and the `PATCH` on
 * `/api/v1/{user}/trips/{trip}` said so out loud in the refusal it hands an
 * agent that guesses: *"A trip's title, dates and cover are still trip.md
 * alone and no call writes them."* So a trip named "Alagrve 2026" needed a
 * shell on the server, which is the hole B220 closed for a journal's title
 * and left open one level down.
 *
 * Built exactly like `tripVisibility.ts` beside it, and sharing its splice:
 * change the one frontmatter line asked about, leave the prose and every
 * other key byte for byte, `matter()`-parse the result before writing so a
 * corrupting edit writes nothing, and read it back afterwards.
 *
 * Owner only. The check is the route's, the same split the other two use — a
 * person on a trip may write days into it, and what the journey is called is
 * the owner's editorial statement about it rather than a fact any traveller
 * may restate.
 */

export type TripDetailsWriteResult =
  | { ok: true; title: string; tagline: string; start: string; end: string }
  | { ok: false; error: string; message?: string; bug?: true };

/** The four as they stand, for the form that edits them. */
export function readTripDetails(
  ref: TripRef,
): { title: string; tagline: string; start: string; end: string } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return {
    title: trip.title,
    tagline: trip.tagline ?? "",
    start: trip.start,
    end: trip.end,
  };
}

/**
 * One line of text, trimmed — or the sentence saying why it is not.
 *
 * Control characters and not only newlines, for the reason `oneLine` in
 * lib/journals.ts gives about a journal's title: this lands in a `<title>`, a
 * sharing card and a mail subject, none of which have a second line.
 */
function oneLine(field: string, value: unknown): { text: string } | { problem: string } {
  if (typeof value !== "string") return { problem: `${field} must be text.` };
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return {
      problem:
        `${field} must be a single line of plain text — it is rendered into the page title, ` +
        `the sharing card and this journal's mail, none of which have a second line.`,
    };
  }
  return { text: value.trim() };
}

export function patchTripDetails(ref: TripRef, raw: unknown): TripDetailsWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    // `invalid_json`, the code lib/api/errorCodes.ts already carries for
    // exactly this — a body the route could not read as an object.
    return { ok: false, error: "invalid_json", message: "Send a JSON object." };
  }
  const body = raw as { title?: unknown; tagline?: unknown; start?: unknown; end?: unknown };

  const before = readTripDetails(ref)!;
  const next = { ...before };

  if (body.title !== undefined) {
    const read = oneLine("title", body.title);
    if ("problem" in read) return { ok: false, error: "invalid_title", message: read.problem };
    if (!read.text) {
      return {
        ok: false,
        error: "invalid_title",
        message:
          "A trip needs a title; it cannot be cleared. It is what the journey is called " +
          "everywhere it is listed, and a trip.md without one does not load at all.",
      };
    }
    next.title = read.text;
  }

  if (body.tagline !== undefined) {
    const read = oneLine("tagline", body.tagline);
    if ("problem" in read) return { ok: false, error: "invalid_tagline", message: read.problem };
    next.tagline = read.text;
  }

  for (const field of ["start", "end"] as const) {
    if (body[field] === undefined) continue;
    const value = body[field];
    if (typeof value !== "string" || !DATE_RE.test(value)) {
      // `invalid_date` rather than a code per field: lib/api/errorCodes.ts
      // already carries it, and its text is written for exactly these two
      // cases — "a date is not a real calendar date, or `end` is before
      // `start`". A second vocabulary for the same two mistakes is a second
      // list to keep in step.
      return {
        ok: false,
        error: "invalid_date",
        message: `${field} must be a date as YYYY-MM-DD, e.g. "2026-04-11".`,
      };
    }
    next[field] = value;
  }

  // Checked against the *result*, so either date may arrive on its own — the
  // same rule `setJournalProfile` applies to `locales`/`defaultLocale`, and
  // for the same reason: a trip whose end precedes its start is skipped at
  // every reading path (lib/trips.ts), so writing one would take the journey
  // off the site rather than move it.
  if (next.end < next.start) {
    return {
      ok: false,
      error: "invalid_date",
      message:
        `end ${next.end} is before start ${next.start}. A trip whose dates run backwards is ` +
        `skipped everywhere it would otherwise be read, so this is refused rather than written.`,
    };
  }

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");

  // `JSON.stringify` for the value: a title with a colon in it — "Japan: end
  // to end" — is not valid YAML unquoted, and this is the one place a person
  // types free text straight into a frontmatter line. JSON's string escaping
  // is a subset of YAML's double-quoted form, so quoting this way is safe for
  // anything `oneLine` has already let through.
  // Only the keys the caller named. Splicing all four every time would
  // rewrite `start: 2026-06-01` as `start: "2026-06-01"` on a save that only
  // fixed a typo in the title — the same value, a different line, and a diff
  // in somebody's git history saying this touched three fields it did not.
  let spliced: string | null = text;
  const lines: [string, string | null][] = [
    ...(body.title !== undefined
      ? ([["title", `title: ${JSON.stringify(next.title)}`]] as [string, string | null][])
      : []),
    // Emptied means the key goes, rather than a `tagline: ""` that says
    // nothing — the rule `listed:` follows next door, and the one
    // `setJournalProfile` follows for a journal's own tagline.
    ...(body.tagline !== undefined
      ? ([
          ["tagline", next.tagline ? `tagline: ${JSON.stringify(next.tagline)}` : null],
        ] as [string, string | null][])
      : []),
    ...(body.start !== undefined
      ? ([["start", `start: ${JSON.stringify(next.start)}`]] as [string, string | null][])
      : []),
    ...(body.end !== undefined
      ? ([["end", `end: ${JSON.stringify(next.end)}`]] as [string, string | null][])
      : []),
  ];
  for (const [key, line] of lines) {
    if (spliced === null) break;
    spliced = spliceScalar(spliced, key, line);
  }
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }

  try {
    matter(spliced);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave trip.md unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  fs.writeFileSync(file, spliced);

  const after = readTripDetails(ref);
  if (
    !after ||
    after.title !== next.title ||
    after.tagline !== next.tagline ||
    after.start !== next.start ||
    after.end !== next.end
  ) {
    return {
      ok: false,
      bug: true,
      error:
        "trip.md was written but does not read back what was asked. This is a bug; please report it.",
    };
  }
  return { ok: true, ...after };
}

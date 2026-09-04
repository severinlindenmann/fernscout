// Validates the shape of an entry before it becomes a markdown file.
//
// Pure on purpose: no fs, no "server-only" import, nothing that only runs in
// a route handler. That is what lets the REST route and `npm run ingest`
// both call the same checks instead of two drifting copies, and what makes
// every rule here testable with a plain object literal.
//
// Every rule returns a PROBLEM, not a boolean — and validateEntry collects
// every problem an input has, not just the first. An agent fixing its own
// mistake needs the whole list in one round trip; a single "something is
// wrong" forces it to guess, fix, resubmit, and find the next one.
import { COST_CATEGORIES, type CostCategory } from "../costFormat";

/** Mirrors `TransportMode` in lib/types.ts. TypeScript has no way to turn a
 * type union back into a runtime array, so this list is kept in sync by hand
 * — there are only seven, and a missing one shows up immediately as a
 * rejected, correct value. */
export const TRANSPORT_MODES = ["flight", "train", "bus", "motorbike", "boat", "car", "walk"] as const;

/** A short slug: lowercase words joined by single hyphens, no leading,
 * trailing or doubled hyphen. The same shape a filename slug is held to
 * elsewhere in this codebase (see `slugify` in lib/slug.ts, which is the one
 * that mints every day slug). */
const TAG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TAG_MAX_LENGTH = 30;

/**
 * Ceilings on the two free-text fields.
 *
 * Every other field was bounded and these two were not, so a 5 000-character
 * title and a 200 000-character body were both accepted — from the lowest-trust
 * credential the system issues. Generous enough that no real day comes near
 * them: a long title is a sentence, and a very long day is a few thousand
 * words.
 */
export const TITLE_MAX_LENGTH = 200;
export const CONTENT_MAX_LENGTH = 100_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type Problem = {
  /** Dotted/indexed path to the bad value, e.g. "costs[1].amount". */
  field: string;
  /** A readable rendering of what arrived — see `describe` below. */
  got: string;
  /** What would have been accepted, in plain words. */
  expected: string;
};

export type EntryCostInput = {
  label?: unknown;
  amount?: unknown;
  currency?: unknown;
  category?: unknown;
};

export type EntryInput = {
  title?: unknown;
  date?: unknown;
  time?: unknown;
  lat?: unknown;
  lng?: unknown;
  transportMode?: unknown;
  costs?: unknown;
  tags?: unknown;
  /** Content nobody lived. See the note on `Entry.test` in lib/types.ts. */
  test?: unknown;
  /** The prose body — "content" is what the REST route calls it. */
  content?: unknown;
};

/**
 * Renders a value the way someone debugging their own payload wants to see
 * it: `undefined` reads as "nothing" rather than the string "undefined", and
 * everything else goes through JSON so a stray string shows its quotes — the
 * difference between "twelve" the number and "twelve" the word that isn't
 * one has to be visible at a glance.
 */
// Exported since B295: the costs door's own validator (lib/validate/costs.ts)
// reads a value back the same way rather than carrying a second renderer.
export function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * `Date` silently rolls an out-of-range day into the next month —
 * `2026-02-30` becomes March 2nd rather than an error — so the only way to
 * catch it is to build the date and check nothing moved.
 */
function isRealCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * `required` defaults to true for `validateEntry` (creation, where a day
 * without a date cannot be filed). `validateEntryEdit` below passes `false`:
 * a PATCH that says nothing about the date is leaving it alone, not sending
 * an invalid one.
 */
function checkDate(input: EntryInput, problems: Problem[], required = true): void {
  if (!required && input.date === undefined) return;
  if (typeof input.date !== "string" || !isRealCalendarDate(input.date)) {
    problems.push({
      field: "date",
      got: describe(input.date),
      expected: "a real calendar date, as YYYY-MM-DD",
    });
  }
}

function checkTime(input: EntryInput, problems: Problem[]): void {
  if (input.time === undefined) return;
  if (typeof input.time !== "string" || !TIME_PATTERN.test(input.time)) {
    problems.push({ field: "time", got: describe(input.time), expected: "HH:mm, 00:00 to 23:59" });
  }
}

/** lat/lng are a pair or nothing: half a coordinate is not a place, it is a
 * typo waiting to be plotted at 0,0. */
function checkCoordinates(input: EntryInput, problems: Problem[]): void {
  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;

  if (hasLat !== hasLng) {
    problems.push({
      field: hasLat ? "lng" : "lat",
      got: "nothing",
      expected: "lat and lng must be given together, or not at all",
    });
  }

  if (hasLat && (typeof input.lat !== "number" || !Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90)) {
    problems.push({ field: "lat", got: describe(input.lat), expected: "-90 to 90" });
  }
  if (hasLng && (typeof input.lng !== "number" || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180)) {
    problems.push({ field: "lng", got: describe(input.lng), expected: "-180 to 180" });
  }
}

function checkTransportMode(input: EntryInput, problems: Problem[]): void {
  if (input.transportMode === undefined) return;
  if (
    typeof input.transportMode !== "string" ||
    !(TRANSPORT_MODES as readonly string[]).includes(input.transportMode)
  ) {
    problems.push({
      field: "transportMode",
      got: describe(input.transportMode),
      expected: `one of ${TRANSPORT_MODES.join(", ")}`,
    });
  }
}

/**
 * Exported since B295: the costs door's own `costs:` list — a trip's
 * preparation spending — is the identical shape as a day's, so it refuses
 * exactly what this refuses rather than a second opinion. Label, amount and
 * category are checked here; currency is not (see `lib/validate/costs.ts`
 * for why the newer door checks it and this one still doesn't).
 */
export function checkCosts(input: EntryInput, problems: Problem[]): void {
  if (input.costs === undefined) return;
  if (!Array.isArray(input.costs)) {
    problems.push({ field: "costs", got: describe(input.costs), expected: "a list of cost items" });
    return;
  }

  input.costs.forEach((raw, i) => {
    const cost = (raw && typeof raw === "object" ? raw : {}) as EntryCostInput;
    const prefix = `costs[${i}]`;

    if (typeof cost.label !== "string" || cost.label.trim() === "") {
      problems.push({ field: `${prefix}.label`, got: describe(cost.label), expected: "a non-empty label" });
    }
    if (typeof cost.amount !== "number" || !Number.isFinite(cost.amount)) {
      problems.push({ field: `${prefix}.amount`, got: describe(cost.amount), expected: "a number" });
    }
    if (
      cost.category !== undefined &&
      !(COST_CATEGORIES as readonly string[]).includes(cost.category as CostCategory)
    ) {
      problems.push({
        field: `${prefix}.category`,
        got: describe(cost.category),
        expected: `one of ${COST_CATEGORIES.join(", ")}`,
      });
    }
  });
}

function checkTags(input: EntryInput, problems: Problem[]): void {
  if (input.tags === undefined) return;
  if (!Array.isArray(input.tags)) {
    problems.push({ field: "tags", got: describe(input.tags), expected: "a list of short, slug-like strings" });
    return;
  }

  input.tags.forEach((raw, i) => {
    const ok = typeof raw === "string" && raw.length > 0 && raw.length <= TAG_MAX_LENGTH && TAG_PATTERN.test(raw);
    if (!ok) {
      problems.push({
        field: `tags[${i}]`,
        got: describe(raw),
        expected: `a short slug of lowercase letters, digits and hyphens, up to ${TAG_MAX_LENGTH} characters`,
      });
    }
  });
}

/** Same `required` story as `checkDate`. */
function checkBody(input: EntryInput, problems: Problem[], required = true): void {
  if (!required && input.content === undefined) return;
  if (typeof input.content !== "string" || input.content.trim() === "") {
    problems.push({ field: "content", got: describe(input.content), expected: "non-empty body text" });
    return;
  }
  if (input.content.length > CONTENT_MAX_LENGTH) {
    problems.push({
      field: "content",
      got: `${input.content.length} characters`,
      expected: `at most ${CONTENT_MAX_LENGTH}`,
    });
  }
}

/** The title is required by `validateDraft`; only its length is checked here. */
function checkTitle(input: EntryInput, problems: Problem[]): void {
  if (typeof input.title === "string" && input.title.length > TITLE_MAX_LENGTH) {
    problems.push({
      field: "title",
      got: `${input.title.length} characters`,
      expected: `at most ${TITLE_MAX_LENGTH}`,
    });
  }
}

/**
 * Every problem with `input`, or an empty list when it is fine to write.
 *
 * Fields absent from `input` are not errors here — `title` is required but
 * checked by `validateDraft` in lib/api/entries.ts, which this module does
 * not duplicate; everything else is optional frontmatter, validated only
 * when present so a bare-minimum entry (date, content) still passes.
 */
export function validateEntry(input: EntryInput): Problem[] {
  const problems: Problem[] = [];
  checkTitle(input, problems);
  checkDate(input, problems);
  checkTime(input, problems);
  checkCoordinates(input, problems);
  checkTransportMode(input, problems);
  checkCosts(input, problems);
  checkTags(input, problems);
  checkTest(input, problems);
  checkBody(input, problems);
  return problems;
}

/**
 * The same rules as `validateEntry`, for `PATCH .../days/<slug>` (B266).
 *
 * A PATCH is a partial edit: a field absent from the body means "leave it
 * alone", not "reject the request" — so `date` and `content`, the two fields
 * creation requires, are checked for shape only when they are present.
 * Every other rule is unchanged, because a value that would be wrong on the
 * way in is wrong on the way in either time.
 *
 * `lat`/`lng` still have to arrive together in the same call — `checkCoordinates`
 * does not know what the day already has on disk, so patching only `lat` on a
 * day that already carries `lng` is refused the same as it would be on
 * creation. ponytail: send both if you want either changed; teach this check
 * the file's existing values if that turns out to matter in practice.
 */
export function validateEntryEdit(input: EntryInput): Problem[] {
  const problems: Problem[] = [];
  checkTitle(input, problems);
  checkDate(input, problems, false);
  checkTime(input, problems);
  checkCoordinates(input, problems);
  checkTransportMode(input, problems);
  checkCosts(input, problems);
  checkTags(input, problems);
  checkTest(input, problems);
  checkBody(input, problems, false);
  return problems;
}

/**
 * `test` must be a real boolean, and a wrong value is refused rather than
 * ignored.
 *
 * Every other optional field here can be dropped silently at worst. This one
 * cannot: a caller sending `"test": "true"` is telling us this day did not
 * happen, and treating that as absent would publish invented content with no
 * banner on it — the exact outcome the flag exists to prevent.
 */
function checkTest(input: EntryInput, problems: Problem[]): void {
  if (input.test === undefined) return;
  if (typeof input.test !== "boolean") {
    problems.push({
      field: "test",
      got: describe(input.test),
      expected: "true or false — the JSON booleans, not the strings",
    });
  }
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { getTrip, tripRef } from "./trips";
import { calendarStatus } from "./tripTime";
import { getUser } from "./users";

/**
 * Creating a trip.
 *
 * The other half of what an agent could not do. `create_day` has always needed
 * a trip to write into, and there was no way to make one, so an agent handed a
 * fresh journal could do precisely nothing with it.
 *
 * A trip is `trip.md` and an `entries/` folder. Everything else — costs, a
 * planned route, media — arrives later and is optional, which is why this
 * writes the smallest thing that reads back as a trip.
 */

/** Same shape a trip id has to have to be read back — `lib/trips.ts`. */
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const ACCENTS = ["sky", "yellow", "green", "coral", "navy"] as const;
const STATUSES = ["upcoming", "current", "past"] as const;
const VISIBILITIES = ["private", "public", "guest"] as const;

export type NewTrip = {
  id: string;
  title: string;
  tagline?: string;
  /** Required, both of them. `readTrip` skips a trip without ISO start and
   * end dates, so a trip written without them would not merely look odd — it
   * would not exist at any reading path, silently. */
  start: string;
  end: string;
  status?: (typeof STATUSES)[number];
  accent?: (typeof ACCENTS)[number];
  visibility?: (typeof VISIBILITIES)[number];
  listed?: boolean;
  /**
   * A trip that exists to prove the software works, not to record anything.
   *
   * Every day of it gets a banner saying so, and none of it reaches the feed,
   * the search index or the sitemap. The one honest way to answer "invent me
   * three days so I can see the whole pipeline" — see lib/types.ts.
   */
  test?: boolean;
  intro?: string;
};

export type CreateTripResult =
  | { ok: true; id: string; ref: string }
  | { ok: false; error: string; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YAML-quote a value that goes on one line. */
function q(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function createTrip(username: string, input: NewTrip): CreateTripResult {
  if (!getUser(username)) {
    return { ok: false, error: "no_such_journal", message: `No journal called "${username}".` };
  }

  const id = input.id.trim().toLowerCase();
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      error: "invalid_trip_id",
      message:
        "A trip id is lowercase letters, digits and dashes, starting with a letter or digit. " +
        "It becomes part of the URL, so `japan-2027` ages better than `the-big-one`.",
    };
  }

  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "invalid_title", message: "A trip needs a title." };
  }

  for (const [field, value] of [
    ["start", input.start],
    ["end", input.end],
  ] as const) {
    if (!value || !DATE_RE.test(value)) {
      return {
        ok: false,
        error: "invalid_date",
        message:
          `${field} is required and must be a date like 2027-04-01. A trip without both ` +
          `dates is skipped when the site reads it, so it would exist on disk and nowhere else.`,
      };
    }
  }
  if (input.end < input.start) {
    return {
      ok: false,
      error: "invalid_date",
      message: `end (${input.end}) is before start (${input.start}).`,
    };
  }

  const dir = path.join(contentRoot(), username, "trips", id);
  if (fs.existsSync(dir)) {
    return {
      ok: false,
      error: "trip_exists",
      message: `"${username}" already has a trip called "${id}".`,
    };
  }

  /**
   * Unstated, the status comes from the dates — not from a hardcoded
   * `upcoming`.
   *
   * That default is what B72 was: a trip created with dates a week in the past
   * was written as `upcoming`, and the site then hid all three days published
   * into it behind a countdown. Reading now derives `past`/`upcoming` from
   * `start` (lib/tripTime.ts), so the word here is a snapshot rather than the
   * authority — but a trip.md whose own frontmatter contradicts its dates from
   * the minute it is written is a file nobody can read straight, and a person
   * opening it in an editor is meant to be the point.
   *
   * An explicit value is still written as asked. `current` is the one the
   * calendar cannot settle, and the other two cost nothing to record.
   */
  const status = STATUSES.includes(input.status as never)
    ? input.status!
    : calendarStatus({ start: input.start });
  const accent = ACCENTS.includes(input.accent as never) ? input.accent! : "sky";
  /**
   * Private unless asked otherwise, and this is the one default that is not a
   * matter of taste.
   *
   * `lib/trips.ts` already reads an unrecognised visibility as private so that
   * a typo cannot publish somebody's trip. A creation endpoint that defaulted
   * to public would walk straight past that care: an agent that omits the
   * field — or misspells it — would put a stranger's journey on the open web,
   * and there is no un-publishing something a crawler has already read.
   */
  const visibility = VISIBILITIES.includes(input.visibility as never)
    ? input.visibility!
    : "private";

  const front: string[] = [
    "---",
    `id: ${id}`,
    `title: ${q(title)}`,
    ...(input.tagline?.trim() ? [`tagline: ${q(input.tagline.trim())}`] : []),
    `start: ${q(input.start)}`,
    `end: ${q(input.end)}`,
    `status: ${status}`,
    `accent: ${accent}`,
    `visibility: ${visibility}`,
    `listed: ${input.listed === false ? "false" : "true"}`,
    // Written only when true. Every trip carrying `test: false` would make the
    // flag look like a routine part of a trip file rather than the unusual
    // thing it is.
    ...(input.test === true ? ["test: true"] : []),
    "---",
    "",
    input.intro?.trim() ? input.intro.trim() : "",
    "",
  ];

  fs.mkdirSync(path.join(dir, "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "trip.md"), front.join("\n"), "utf8");

  // No cache to clear: `getTrips` fingerprints the trip folders with a stat
  // per trip and re-reads when that changes, so a new folder is picked up on
  // the next call by itself.

  // Read it back rather than trusting the write: a trip that does not parse is
  // invisible at every reading path, and the caller should hear that now
  // rather than discover an empty journal later.
  const ref = tripRef(username, id);
  if (!getTrip(ref)) {
    return {
      ok: false,
      error: "trip_unreadable",
      message: "The trip was written but does not read back. This is a bug; please report it.",
    };
  }

  return { ok: true, id, ref };
}

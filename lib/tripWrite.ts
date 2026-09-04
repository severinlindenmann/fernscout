import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { getTrip, tripRef } from "./trips";
import { calendarStatus } from "./tripTime";
import { getUser } from "./users";
import { quoteScalar, singleLineProblem } from "./validate/frontmatter";

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
/** Mirrors `CostsVisibility` in lib/types.ts and `parseCostsVisibility` in
 * lib/trips.ts — the two spellings the reader understands. */
const COSTS_VISIBILITIES = ["public", "guests"] as const;

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
  /**
   * Whether the trip is advertised — sitemap, feed, switcher. Only ever
   * narrows: `false` on a public trip is the old `unlisted`, and `true` on a
   * trip no visibility advertises is refused rather than written, because
   * `lib/trips.ts` would refuse it on the way back in. B51.
   */
  listed?: boolean;
  /**
   * Who among the readers who may open the trip may see what it cost.
   *
   * `public` — the default, and what an absent key reads as — means anybody
   * who can read the trip can read its money. `guests` narrows that to
   * somebody who was on the trip or whom the owner has approved into the
   * journal (`maySeeCosts`, lib/access.ts).
   *
   * It was read, typed, gated and documented, and nothing could write it:
   * every trip on every instance had public costs and the guests-only branch
   * had nothing to act on. With no editing interface anywhere in this product
   * (ROADMAP decision 24), an owner who works through an agent could not
   * reach a feature the site says it has. B178.
   *
   * Note this is not `visibility`: it decides nothing about who may open the
   * trip, only whether the numbers are drawn once they are in.
   */
  costsVisibility?: (typeof COSTS_VISIBILITIES)[number];
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

  /**
   * The two fields that become a quoted scalar on one line of the frontmatter,
   * refused here rather than escaped away. B204.
   *
   * `quoteScalar` would now write `\n` and the file would parse, so this is
   * not what stops the folder being bricked — it is what stops the caller
   * being told 201 for a title it did not ask for. A trip called
   * "Japan\n---\nnot: [yaml" is nobody's trip title, and naming the field is
   * an error an agent can act on.
   *
   * `intro` is deliberately absent: it is prose below the closing `---` and
   * multiple lines are the point.
   */
  for (const [field, value] of [
    ["title", title],
    ["tagline", input.tagline?.trim() ?? ""],
  ] as const) {
    const problem = singleLineProblem(field, value);
    if (problem) {
      return { ok: false, error: `invalid_${field}`, message: problem };
    }
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

  /**
   * An unrecognised `costsVisibility` is **refused, not defaulted** — the one
   * place in this function where a typo does not fall back to a default, and
   * for the same reason `visibility` does fall back to `private`.
   *
   * The safe end of this axis is `guests`, and that is what the reader picks
   * for a value it does not know (`parseCostsVisibility`, lib/trips.ts).
   * Defaulting a misspelling to `public` here would therefore both widen what
   * the caller asked for and disagree with the reader about the same file.
   * Defaulting it to `guests` would hide the money of every caller who typed
   * "publik". Neither is a thing to do silently to somebody's trip, so the
   * caller hears about it instead.
   */
  const costsVisibility = input.costsVisibility;
  if (costsVisibility !== undefined && !COSTS_VISIBILITIES.includes(costsVisibility)) {
    return {
      ok: false,
      error: "invalid_costs_visibility",
      message:
        `costsVisibility "${costsVisibility}" is not a value this reads. It is ` +
        `"public" — anybody who can open the trip sees what it cost — or "guests", which ` +
        `narrows the numbers to the people who were on the trip and the readers you have ` +
        `approved into the journal. It does not decide who may open the trip; visibility does.`,
    };
  }

  /**
   * `listed: true` on a trip nothing advertises is a request the reader will
   * refuse, so refuse it here where somebody is listening.
   *
   * The alternative — write it anyway — is B51 again: the file would say one
   * thing, `lib/trips.ts` would read another, and the caller would be told 201.
   * Saying so costs one error and teaches the axis; only `public` advertises.
   */
  if (input.listed === true && visibility !== "public") {
    return {
      ok: false,
      error: "invalid_listed",
      message:
        `listed: true asks for the trip to be advertised — in the sitemap, the feed and the ` +
        `trip switcher — but visibility "${visibility}" does not put it in front of anybody. ` +
        `Only a public trip is advertised. Drop listed, or set visibility to "public".`,
    };
  }

  const front: string[] = [
    "---",
    `id: ${id}`,
    `title: ${quoteScalar(title)}`,
    ...(input.tagline?.trim() ? [`tagline: ${quoteScalar(input.tagline.trim())}`] : []),
    `start: ${quoteScalar(input.start)}`,
    `end: ${quoteScalar(input.end)}`,
    `status: ${status}`,
    `accent: ${accent}`,
    `visibility: ${visibility}`,
    // Written only when it says something `visibility:` has not already said,
    // for the same reason `test:` is. Every trip carrying `listed: true` made
    // the key look like a routine part of a trip file, and it was the one key
    // the reader ignored — so the line most often present was also the line
    // least often true.
    ...(input.listed === false ? ["listed: false"] : []),
    // Written only when it narrows, on the same reasoning as `listed:` above:
    // an absent key reads as `public`, so `costsVisibility: public` in every
    // file would be a line that never says anything, in a file a person is
    // meant to be able to open and read straight. B178.
    ...(costsVisibility === "guests" ? ["costsVisibility: guests"] : []),
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
    /**
     * Roll back, because a refusal that leaves the folder behind is worse
     * than the write it refused. B204.
     *
     * The folder is invisible at every reading path — that is what "does not
     * read back" means — and every delete path resolves the trip first, so
     * nothing in the product could remove it afterwards. The id was consumed
     * for good and the only cure was a shell on the server.
     *
     * Safe to remove because of the `existsSync` guard above: this function
     * returns `trip_exists` when the directory is already there, so by the
     * time control reaches here the folder is one this call made and holds
     * nothing but the `trip.md` and empty `entries/` written six lines up.
     */
    let removed = true;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      removed = false;
    }
    return {
      ok: false,
      error: "trip_unreadable",
      message:
        "The trip was written but does not read back, so it was removed again" +
        (removed
          ? ` and the id "${id}" is still free.`
          : ` — but the folder could not be cleaned up, so "${id}" is taken until somebody removes it on the server.`) +
        " This is a bug; please report it.",
    };
  }

  return { ok: true, id, ref };
}

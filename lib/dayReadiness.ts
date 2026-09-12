import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dayInboxDir } from "./inbox";
import { parseUnrecorded, parseWithout, type Track } from "./tracks";

/**
 * `day.json` — what a date folder knows about itself, before there is a real
 * entry to know it instead — B1573's Phase 2.
 *
 * Speaks `lib/tracks.ts`'s vocabulary rather than a new one: `without` and
 * `unrecorded` are exactly `Track[]`, the same values `withoutLine`/
 * `unrecordedLine` already render into an entry's frontmatter, so handing
 * this record to Phase 3's day-creation step is a direct copy, not a
 * translation. `weatherAsked` mirrors `Entry.weatherAsked` the same way.
 *
 * What is deliberately absent: whether photographs exist (read the folder),
 * whether words exist (read `words.md`). A day folder answering a question
 * the folder itself could already answer is a second copy of a fact that
 * could disagree with the first.
 */
export type DayReadiness = {
  without: Track[];
  unrecorded: Track[];
  weatherAsked: boolean;
  /** Set alongside `weatherAsked` only when the answer was "look it up" —
   *  `weatherAsked` alone means only "asked", never which way it went, and
   *  the create step needs to tell "look it up" from "no" to know whether to
   *  request the archive at all. */
  weatherLookup?: boolean;
  /** A coordinate this date is tied to, and where it came from — the same
   *  three-word vocabulary `InboxMeta.source` uses for a file's own origin,
   *  restated here because a day's location may come from the browser
   *  button, a WhatsApp pin, or (Phase 5) an extracted GPS fix, and a later
   *  reader needs to tell those apart exactly as it does for a photograph. */
  location?: { lat: number; lon: number; source: "browser" | "whatsapp" | "gps" };
};

const EMPTY: DayReadiness = { without: [], unrecorded: [], weatherAsked: false };

const LOCATION_SOURCES = ["browser", "whatsapp", "gps"];

function readinessPath(username: string, date: string): string {
  return path.join(dayInboxDir(username, date), "day.json");
}

/** `raw.location`, if it is shaped the way `DayReadiness.location` promises —
 *  `without`/`unrecorded` go through `parseWithout`/`parseUnrecorded` for the
 *  same reason: `day.json` is hand-editable, and trusting a malformed
 *  `source` or a non-numeric coordinate through unchecked would hand a later
 *  reader a location that looks real and is not. */
function parseLocation(raw: unknown): DayReadiness["location"] {
  if (!raw || typeof raw !== "object") return undefined;
  const { lat, lon, source } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number") return undefined;
  if (typeof source !== "string" || !LOCATION_SOURCES.includes(source)) return undefined;
  return { lat, lon, source: source as "browser" | "whatsapp" | "gps" };
}

/** What this date folder currently says about itself. A date with no folder
 *  yet, or a `day.json` that fails to parse, reads as `EMPTY` — the honest
 *  answer for "nothing decided" and for "nothing written down" alike. */
export function readDayReadiness(username: string, date: string): DayReadiness {
  try {
    const raw = JSON.parse(fs.readFileSync(readinessPath(username, date), "utf8")) as Partial<DayReadiness>;
    return {
      without: parseWithout(raw.without),
      unrecorded: parseUnrecorded(raw.unrecorded),
      weatherAsked: raw.weatherAsked === true,
      weatherLookup: raw.weatherLookup === true ? true : undefined,
      location: parseLocation(raw.location),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Merge a patch into what this date folder already says — never a
 *  replace, so answering one question in a batch cannot silently erase an
 *  earlier answer to a different one. */
export function writeDayReadiness(
  username: string,
  date: string,
  patch: Partial<DayReadiness>,
): DayReadiness {
  const current = readDayReadiness(username, date);
  const merged: DayReadiness = {
    without: patch.without ?? current.without,
    unrecorded: patch.unrecorded ?? current.unrecorded,
    weatherAsked: patch.weatherAsked ?? current.weatherAsked,
    weatherLookup: patch.weatherLookup ?? current.weatherLookup,
    location: patch.location ?? current.location,
  };
  const dir = dayInboxDir(username, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(readinessPath(username, date), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

function wordsPath(username: string, date: string): string {
  return path.join(dayInboxDir(username, date), "words.md");
}

/** The prose accumulated for this date so far. Empty string for a date with
 *  no `words.md` yet — nothing said, not an error. */
export function readWords(username: string, date: string): string {
  try {
    return fs.readFileSync(wordsPath(username, date), "utf8").trimEnd();
  } catch {
    return "";
  }
}

/** Add one paragraph — a sentence somebody typed, or a transcription — to
 *  this date's accumulated words. Never overwrites what is already there;
 *  every call appends, blank-line separated, the ordinary markdown paragraph
 *  break. */
export function appendWords(username: string, date: string, paragraph: string): void {
  const dir = dayInboxDir(username, date);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readWords(username, date);
  const next = existing === "" ? paragraph : `${existing}\n\n${paragraph}`;
  fs.writeFileSync(wordsPath(username, date), `${next}\n`);
}

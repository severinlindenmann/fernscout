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
   *  vocabulary `InboxMeta.source` uses for a file's own origin, restated
   *  here because a day's location may come from the browser button, a
   *  WhatsApp pin, an imported photograph's own EXIF (B1751 — a real
   *  measurement the camera took, median of every kept photograph's fix for
   *  the day, never a guess), or (Phase 5) an extracted GPS-history fix, and
   *  a later reader needs to tell those apart exactly as it does for a
   *  photograph. */
  location?: { lat: number; lon: number; source: "browser" | "whatsapp" | "gps" | "photo" };
  /** What the WhatsApp funnel (B1854/B1856/B1857) has asked and learned about
   *  this date. This lives on disk rather than in the thread because the
   *  thread expires after 24 hours: without a durable record, a dropped
   *  thread re-asks a question somebody already declined, and `draftWords` —
   *  the prose a paid write-up composes — would disappear with it, so the
   *  credit that bought it bought nothing. A dropped thread should cost
   *  turns, never state. */
  funnel: FunnelState;
};

/** One date's progress through the WhatsApp funnel. Every field but `stage`
 *  is optional because most dates never reach it — a date with photographs
 *  and nothing else stays `collecting` forever, and that is fine. */
/** @public open core: paid/ uses this (tagged by open-core/split). */
export type FunnelState = {
  stage: "collecting" | "drafted" | "ready" | "published";
  /** Resolved once, the first time this date needed a trip, and pinned here
   *  rather than re-resolved on every message — two trips overlapping on the
   *  calendar must not resolve differently across two turns of the same
   *  conversation. */
  trip?: string;
  /** What is outstanding right now, so a reply lands on the right question
   *  even after the thread that asked it is gone. */
  asked?: string;
  /** When `asked` was set — B1857. The one thing a durable-on-disk gap
   *  question needs that a thread turn already gets for free (a timestamp);
   *  `paid/whatsapp/lib/whatsapp/funnel/gaps.ts`'s +20h nudge is timed from this, not from
   *  the thread, since the thread that asked may already be gone by then.
   *  Cleared alongside `asked` the moment the question is resolved or
   *  declined. */
  askedAt?: string;
  /** A hard ceiling of 2 asks, ever, for this day — counted here rather than
   *  in the thread, because the thread is exactly what does not survive to
   *  enforce it. */
  asksSent?: number;
  /** Questions this date has already been asked and said no to. A fresh
   *  thread must never re-ask one of these; re-asking a decline is worse
   *  than not asking at all. */
  declined?: string[];
  /** The one scheduled nudge, sent at +20h, window permitting. `null` once
   *  sent, so it is never sent twice; absent before that. */
  nudgedAt?: string | null;
  /** The paperclip-ladder rung this date's owner has been taught, tracked
   *  per trip rather than per number so the same person on a later trip
   *  starts from what they already learned. */
  taughtRung?: number;
  /** Prose a paid write-up composed. This is the field the whole ticket
   *  exists for: composing into the thread and writing nothing durable meant
   *  a write-up somebody paid for died with the thread — the credit bought
   *  nothing once the thread expired. */
  draftWords?: { title: string; prose: string };
};

/** A patch to `writeDayReadiness`. `funnel` is itself a partial — merged
 *  field-by-field into the existing funnel block — so answering one funnel
 *  question (say, `asksSent`) cannot wipe `declined` or `draftWords`.
 *
 *  `FunnelState` is exported since B1856 (`paid/whatsapp/lib/whatsapp/funnel/draft.ts`,
 *  which reads `readiness.funnel.stage` to decide whether a new batch of
 *  photographs is allowed to move the stage to `"drafted"` — never backwards
 *  over `"ready"`/`"published"`). Before that it stayed unexported: nothing
 *  imported it, and knip fails an export with no caller. */
/** @public open core: paid/ uses this (tagged by open-core/split). */
export type DayReadinessPatch = Partial<Omit<DayReadiness, "funnel">> & {
  funnel?: Partial<FunnelState>;
};

const EMPTY_FUNNEL: FunnelState = { stage: "collecting" };

const EMPTY: DayReadiness = { without: [], unrecorded: [], weatherAsked: false, funnel: EMPTY_FUNNEL };

const LOCATION_SOURCES = ["browser", "whatsapp", "gps", "photo"];

const FUNNEL_STAGES = ["collecting", "drafted", "ready", "published"];

/** `raw.funnel`, tolerant the same way `parseLocation` is: `day.json` is
 *  hand-editable and predates the funnel entirely, so a missing or malformed
 *  block must read as `collecting` — never throw, never invent a stage that
 *  was never written. */
function parseFunnel(raw: unknown): FunnelState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_FUNNEL };
  const f = raw as Record<string, unknown>;
  const stage =
    typeof f.stage === "string" && FUNNEL_STAGES.includes(f.stage) ? (f.stage as FunnelState["stage"]) : "collecting";
  const result: FunnelState = { stage };
  if (typeof f.trip === "string") result.trip = f.trip;
  if (typeof f.asked === "string") result.asked = f.asked;
  if (typeof f.askedAt === "string") result.askedAt = f.askedAt;
  if (typeof f.asksSent === "number") result.asksSent = f.asksSent;
  if (Array.isArray(f.declined) && f.declined.every((d) => typeof d === "string")) {
    result.declined = f.declined as string[];
  }
  if (f.nudgedAt === null) result.nudgedAt = null;
  else if (typeof f.nudgedAt === "string") result.nudgedAt = f.nudgedAt;
  if (typeof f.taughtRung === "number") result.taughtRung = f.taughtRung;
  if (
    f.draftWords &&
    typeof f.draftWords === "object" &&
    typeof (f.draftWords as Record<string, unknown>).title === "string" &&
    typeof (f.draftWords as Record<string, unknown>).prose === "string"
  ) {
    const { title, prose } = f.draftWords as Record<string, unknown>;
    result.draftWords = { title: title as string, prose: prose as string };
  }
  return result;
}

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
  return { lat, lon, source: source as "browser" | "whatsapp" | "gps" | "photo" };
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
      funnel: parseFunnel(raw.funnel),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Merge a patch into what this date folder already says — never a
 *  replace, so answering one question in a batch cannot silently erase an
 *  earlier answer to a different one. `funnel` gets the same treatment one
 *  level deeper: `patch.funnel` merges field-by-field into the existing
 *  funnel block, so writing `asksSent` cannot wipe `declined` or
 *  `draftWords`. */
export function writeDayReadiness(
  username: string,
  date: string,
  patch: DayReadinessPatch,
): DayReadiness {
  const current = readDayReadiness(username, date);
  const merged: DayReadiness = {
    without: patch.without ?? current.without,
    unrecorded: patch.unrecorded ?? current.unrecorded,
    weatherAsked: patch.weatherAsked ?? current.weatherAsked,
    weatherLookup: patch.weatherLookup ?? current.weatherLookup,
    location: patch.location ?? current.location,
    funnel: patch.funnel ? { ...current.funnel, ...patch.funnel } : current.funnel,
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

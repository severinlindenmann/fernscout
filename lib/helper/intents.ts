import "server-only";
import { balanceOf } from "../credits";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { formatBytes, storageFor } from "../storageQuota";
import { getTrips } from "../trips";
import { draftsForWizard } from "./server";

/**
 * The registry — B685, and §3 of `docs/plans/2026-09-07-web-helper-agent.md`.
 *
 * **One row per thing the helper can do.** The row carries the intent's name,
 * the slots it takes, and what runs; the list the model is shown is *generated
 * from this array* (`intentList()`, used by `ROUTER_SYSTEM_PROMPT` in
 * `./model.ts`), so the prompt cannot promise a capability that does not exist
 * and cannot forget one that does. Adding a capability later is a row here and
 * nothing else.
 *
 * **The model routes; it never executes.** It is handed no client, no tools
 * and no way to call anything: it returns a row name and some strings, and the
 * code below looks the row up. Everything that happens afterwards happens
 * because a person pressed something.
 *
 * Three kinds, and the difference between them is who is asked and when:
 *
 * - `read` answers immediately. These are GETs a person could make themselves
 *   from their own page; there is nothing to confirm about being told a
 *   number.
 * - `open` goes to a screen with the fields filled in. It writes nothing —
 *   the screen it lands on has its own gates and its own buttons.
 * - `write` is confirmed with its fields visible, **however confident the
 *   router was**, and only then posts to the endpoint named here. Publish,
 *   postcards and deletion are deliberately not rows: they keep their own
 *   existing gates, and deletion still ends in a mailbox.
 */

/** One field the model may fill in. Never applied silently — a slot is a
 *  prefilled, editable box, so a wrong guess costs a tap to correct. */
type Slot = {
  name: string;
  /** What it is, in the words the model is shown. */
  describe: string;
  /** ISO `YYYY-MM-DD`. A value that is not one is dropped rather than shown. */
  date?: true;
};

export type Slots = Record<string, string>;

/** Translating, passed in rather than imported, so an answer is in the
 *  reader's own language and this file holds no English. */
export type Say = (key: string, vars?: Record<string, string>) => string;

type Row = {
  name: string;
  describe: string;
  slots: Slot[];
};

export type Intent = Row &
  (
    | { kind: "read"; answer: (username: string, say: Say) => Promise<string> }
    | { kind: "open"; href: (username: string, slots: Slots) => string }
    | { kind: "write"; endpoint: (username: string) => string }
  );

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REGISTRY: readonly Intent[] = [
  {
    name: "new_trip",
    kind: "write",
    describe: "Start a new trip — a journey with a title and a first and last day.",
    slots: [
      { name: "title", describe: "what the trip is called, in the writer's own words" },
      { name: "start", describe: "the first day", date: true },
      { name: "end", describe: "the last day", date: true },
    ],
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip`,
  },
  {
    name: "write_day",
    kind: "open",
    describe: "Write up a day of a trip — photographs, what happened, and the words.",
    slots: [
      { name: "date", describe: "the day being written up", date: true },
      { name: "trip", describe: "the trip id it belongs to, if the person named one" },
    ],
    // The wizard is the multi-step machine and it is already built; this only
    // opens it. The slots ride along in the query string, which is where the
    // wizard reads a prefill from when it learns to.
    href: (username, slots) => {
      const query = new URLSearchParams(
        Object.entries(slots).filter(([, value]) => value !== ""),
      ).toString();
      return `/agent/${encodeURIComponent(username)}${query ? `?${query}` : ""}`;
    },
  },
  {
    name: "storage",
    kind: "read",
    // B808 — "How much room this journal is using" caught "wheres my stuff" at
    // 0.72, and the person was told about disk space when they meant their
    // photographs. The row answers about bytes and nothing else, so it says so.
    describe:
      "How much disk space this journal is taking up, and how many megabytes are left before its storage limit. Bytes on disk only — never where a photograph, a day or a file has got to.",
    slots: [],
    answer: async (username, say) => {
      const usage = await storageFor(username);
      if (usage.limitBytes === null) {
        return say("agent.askStorageNoLimit", { used: formatBytes(usage.usedBytes) });
      }
      return say("agent.askStorage", {
        used: formatBytes(usage.usedBytes),
        limit: formatBytes(usage.limitBytes),
        left: formatBytes(usage.remainingBytes ?? 0),
      });
    },
  },
  {
    // B783 — "whats my trip called" came back `unknown` at 0.1. It is the
    // first thing anybody asks and there was no row for it.
    name: "what_is_my_trip",
    kind: "read",
    describe:
      "What the trip being written is called, the days it runs between, how many of its days are written and how many are still drafts.",
    slots: [],
    answer: async (username, say) => {
      const trips = getTrips(username);
      if (trips.length === 0) return say("agent.askTripNone");
      // The newest by start date: the one somebody writing today means.
      const trip = [...trips].sort((a, b) => b.start.localeCompare(a.start))[0];
      const entries = getAllEntries(trip.ref, AS_AUTHOR);
      // Days, not updates — several updates on one date are one day to a
      // reader, and "how many days are written" is the reader's question.
      const days = (draft: boolean) =>
        // `draft` is absent rather than false on a published entry, so this
        // asks Boolean of it — `=== false` counted every published day as
        // neither written nor a draft.
        String(new Set(entries.filter((e) => Boolean(e.draft) === draft).map((e) => e.date)).size);
      return say("agent.askTrip", {
        title: trip.title,
        start: trip.start,
        end: trip.end,
        written: days(false),
        drafts: days(true),
      });
    },
  },
  {
    name: "credits",
    kind: "read",
    describe: "How many credits are left on this journal.",
    slots: [],
    answer: async (username, say) => {
      const balance = await balanceOf(username);
      return balance === null
        ? say("agent.askCreditsOff")
        : say("agent.askCredits", { count: String(balance) });
    },
  },
  {
    name: "unfinished",
    kind: "read",
    describe: "What is still a draft in this journal — days started and not published.",
    slots: [],
    answer: async (username, say) => {
      const drafts = draftsForWizard(username);
      if (drafts.length === 0) return say("agent.askUnfinishedNone");
      return say("agent.askUnfinished", {
        count: String(drafts.length),
        date: drafts[0].date,
      });
    },
  },
];

export function intentFor(name: string): Intent | null {
  return REGISTRY.find((row) => row.name === name) ?? null;
}

/**
 * The menu the model is shown, generated.
 *
 * This is the whole point of the registry being an array: a hand-written list
 * in the prompt is a list that goes stale the first afternoon somebody adds a
 * capability, and stale here means the model routing to a row that no longer
 * exists or never offering one that does.
 */
export function intentList(): string {
  return REGISTRY.map((row) => {
    const slots =
      row.slots.length === 0
        ? "no slots"
        : row.slots.map((slot) => `${slot.name} (${slot.describe})`).join("; ");
    return `- ${row.name}: ${row.describe} Slots: ${slots}.`;
  }).join("\n");
}

/**
 * The model's strings, kept only where they fit a slot this row declares.
 *
 * Anything else it invented — a slot nobody asked for, a date that is not one,
 * a paragraph where a title was wanted — is dropped here rather than shown to
 * somebody as a prefilled field they might not read.
 */
export function slotsFor(intent: Intent, raw: unknown): Slots {
  const given = (raw ?? {}) as Record<string, unknown>;
  const out: Slots = {};
  for (const slot of intent.slots) {
    const value = given[slot.name];
    const text = typeof value === "string" ? value.trim().slice(0, 200) : "";
    if (text === "") continue;
    if (slot.date && !DATE_RE.test(text)) continue;
    out[slot.name] = text;
  }
  return out;
}

/* -------------------------------------------------------------------------
 * The territories with no row, and what is said instead — B817 and B783.
 *
 * **This is a safety mechanism before it is a courtesy.** "take down the day
 * with the photo of anna" routed to `write_day` and opened the wizard at step
 * one, pre-set to today, ready to *create* a day. Nothing was wrong with the
 * model: the registry has no row anywhere near removal, so the nearest
 * neighbour won, and the nearest neighbour to "take this down" is the screen
 * that puts things up.
 *
 * So these are matched **in this file, from the sentence itself, before a
 * model is asked anything at all.** Not a low-confidence fallback and not a
 * check on what came back: a deterministic refusal that no confidence can get
 * past, because the failure it prevents is a person publishing a day while
 * trying to remove one.
 *
 * Each refusal is an *answer*: it names what it will not do and says where the
 * thing actually happens. None of them is a route to doing it, and the removal
 * one in particular must never read as though this box could delete something
 * if only it were asked more nicely. It cannot, and it never has been able to.
 *
 * The words are matched in three languages because the box is offered in
 * three. A stem rather than a whole word wherever the language inflects
 * ("lösch" for löschen/lösche/gelöscht, "törl" for törlés/törölni), and no
 * `\b` around the non-ASCII ones.
 * ---------------------------------------------------------------------- */
export type Refusal = {
  /** Reported as the intent, so this is visible in a log and in a test. */
  name: string;
  match: RegExp;
  /** The sentence shown, in the reader's own language. */
  key: string;
};

const REFUSALS: readonly Refusal[] = [
  {
    // First, always: "unpublish" is removal before it is publishing, and a
    // sentence that says both is a sentence about taking something away.
    name: "remove",
    match:
      /\b(delete|deleting|deleted|remove|removing|removed|erase|unpublish|takedown|take down|get rid of)\b|\btake\b[^.!?]{0,40}\bdown\b|lösch|entfern|runternehm|wegnehm|nimm[^.!?]{0,40}(runter|herunter|weg)|törl|töröl|távolít|vedd le|levesz|levenn|leszed/i,
    key: "agent.askRefuseRemove",
  },
  {
    name: "publish",
    match: /\b(publish|publishing|publishes|go live)\b|veröffentlich|publizier|freischalt|közzé|publikál/i,
    key: "agent.askRefusePublish",
  },
  {
    name: "postcard",
    match: /\bpostcards?\b|postkarte|ansichtskarte|képeslap|levelezőlap/i,
    key: "agent.askRefusePostcard",
  },
];

/**
 * The refusal a sentence has earned, or null.
 *
 * Null is the ordinary case and means the router runs as before. `unknown`
 * keeps its own job — a sentence nobody could map — and this is the other
 * thing: a sentence understood well enough to be refused by name.
 */
export function refusalFor(said: string): Refusal | null {
  return REFUSALS.find((refusal) => refusal.match.test(said)) ?? null;
}

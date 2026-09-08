import "server-only";
import { isEnabled } from "../capabilities";
import { listContacts } from "../contacts";
import { balanceOf } from "../credits";
import { factsOfEntry } from "../api/entries";
import { COST_CATEGORIES, getCostSummary } from "../costs";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { findInboxFile } from "../inbox";
import { formatBytes, storageFor } from "../storageQuota";
import { ALL_TRACKED, missingFrom, TRACK_ROWS, TRACKS, UNKNOWN } from "../tracks";
import { getTrip, getTrips, tripRef } from "../trips";
import type { Block, Proposal, ProposalField, Shape } from "./blocks";
import type { Say } from "./intents";
import { draftsForWizard } from "./server";

/**
 * The tool contract — B898, and the proposals a person can actually accept —
 * B900. Rounds 1 and 3 of `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * **One registry, and the model's list is generated from it.** The prose menu
 * the prompt carries (`toolList()`) and the JSON schemas the SDK is handed
 * (`toolSchemas()`) are both built from `TOOLS`. Adding a tool is a row here
 * and nothing else — no client change, because the client draws shapes rather
 * than tools, and since B900 a proposal carries the route its press goes to
 * so the browser still knows nothing about any particular tool.
 *
 * **Since B900 this is the only registry.** `./intents.ts` used to hold a
 * second one, matched *before* the thread, and a sentence a row happened to
 * cover never reached these tools at all: "zeig mir meine reisen" was answered
 * as prose where `trips` answers as a list, and "mach mir einen tag von
 * gestern" handed over a wizard URL where `start_day` proposes a day. Two
 * routers is worse than either, so that one is gone and what is left of the
 * file is the refusal table, which still runs first and still never asks a
 * model anything.
 *
 * **Three kinds, three behaviours, and the difference is the whole design.**
 * They are separate members of a union rather than a `kind` field on one
 * shape, so the difference is enforced by the compiler and not by a comment:
 *
 * - **read** — has a `run`, executes immediately, returns its rendered block.
 *   There is nothing to confirm about a question.
 * - **write** — has **no `run` at all.** It has `propose`, which may read this
 *   journal to fill a field in or draw a preview, and which returns a sentence
 *   and some fields and writes nothing. What accepts it is `endpoint`: an
 *   existing helper route, the same one the wizard's own button posts to, so
 *   there is exactly one path to disk and it is the one that already
 *   validates and refuses. A write tool cannot reach `fs` on its own — it has
 *   nothing to call that would.
 * - **link** — returns a sentence and a URL and touches nothing. This is how a
 *   thing that must happen on its own page stays there.
 *
 * **Deletion has no tool and postcard sending has no tool**, and neither is a
 * `link` either: both are matched by the refusal table in `./intents.ts`
 * *before* the model is called (B817), which is stricter than a tool the model
 * could choose. Deleting finishes in a mailbox and a postcard finishes on the
 * owner's own preview page, and an agent that offered a shortcut to either
 * would be offering one it cannot honour.
 *
 * **`unpublish_day` is not a delete and must not grow into one.** It puts a
 * day back to being a draft: off the site, still on disk, with every
 * photograph attached to it, and publishing again is the undo (B816). It is
 * the only takedown a conversation has, and the words that mean *destroy*
 * still never reach a model.
 *
 * **Nothing here reads `gps/`.** The store in `lib/gps/store.ts` is reachable
 * from no route and from no tool, and a coordinate must never travel to a
 * model in a tool result. What these tools return is what the owner's own
 * screen already shows them about their own journal.
 */

/** The arguments schema: JSON Schema properties, strings only. */
type Properties = Record<string, { type: "string"; description: string }>;

type Named = {
  name: string;
  /** The sentence the model reads when deciding whether to call it. */
  describe: string;
  properties: Properties;
};

/** What a `propose` hands back. Nothing in it has happened. */
type Proposed = {
  sentence: string;
  fields: ProposalField[];
  /** The word on the button — what it does, never "OK" (B633). */
  accept: string;
  /** What the conversation says once the press has gone through. */
  done: string;
  /**
   * The thing as it stands, drawn *before* the press.
   *
   * `publish_day` is why this exists and it is not optional there: a day goes
   * on the site after somebody has read it back, so the proposal renders the
   * day and then the one button. It never fires from a sentence.
   */
  preview?: string[];
  /**
   * The tool declining itself, in words — B951.
   *
   * A translation key. `proposalFor` returns this sentence and no proposal, so
   * there is no button and the model is told what to say instead.
   *
   * The existing way to propose nothing is to leave a required field empty,
   * and it answers only one question — *which* day, *which* trip. This
   * answers the other one: the day is right and its **state** is wrong.
   * Asking to take down a day that is still a draft produced a card saying it
   * *"comes off the site"*, about a day that had never been on it. Nothing
   * was written, because `POST .../day/unpublish` refuses with
   * `already_draft` — but the sentence a person read before pressing was
   * false about their own journal, which is B944's fault one step earlier.
   */
  refuse?: string;
  /**
   * The proposal that opens after this one is pressed — B969, and it is here
   * rather than only on the tool because whether there *is* a next one can
   * depend on what was said.
   *
   * `start_day` chains to `draft_words` when somebody gave it a day's worth of
   * notes, and to nothing when they did not: offering to write up an empty day
   * would be a card asking to spend a credit on nothing.
   */
  next?: { tool: string; from: Record<string, string> };
};

export type Tool = Named &
  (
    | {
        kind: "read";
        renders: Shape;
        run: (username: string, args: Record<string, string>) => Promise<unknown>;
        /**
         * How the result is drawn. Absent **only** when `renders` is `say`:
         * prose is the model's own sentence and there is nothing extra to
         * put on the screen beside it. `test/helper-tools.test.ts` fails on
         * any other tool that omits it.
         */
        block?: (data: unknown, say: Say) => Block | null;
      }
    | {
        kind: "write";
        renders: "form" | "confirm";
        propose: (
          username: string,
          args: Record<string, string>,
          say: Say,
          /** The person's own today, from their browser — "yesterday" is
           *  answered from where they are standing, not from the server. */
          today: string,
          /**
           * What is ticked in the files pane, as the browser sends it — B925.
           *
           * A tool that needs the selection reads it here rather than asking
           * the person for ids they cannot see. Most tools declare four
           * parameters and ignore this one, which is what a narrower function
           * signature is allowed to do.
           */
          selected: string[],
        ) => Promise<Proposed>;
        /** The helper route the press posts to — never `/api/v1`, never a
         *  route that deletes. `test/helper-tools.test.ts` asserts the list. */
        endpoint: (username: string) => string;
        method?: "PATCH";
        /** The proposal that opens next, carrying what came back — see
         *  `Proposal.next` in `./blocks.ts`. */
        next?: { tool: string; from: Record<string, string> };
      }
    | {
        kind: "link";
        renders: "link";
        link: (
          username: string,
          args: Record<string, string>,
          say: Say,
        ) => { text: string; href: string; label: string };
      }
  );

/** Letters and digits, lower case, everything else a single space — so
 *  "Georgia 2026", "georgia-2026" and "GEORGIA" are one word to compare. */
function flatten(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The trip somebody means — **by name, not by id** (B927).
 *
 * The model was guessing an id back from the title: it made a trip called
 * Georgia, the server answered `georgia-2026`, and two turns later it wrote
 * `georgia` and got `unknown_trip` three times in one session. An id it never
 * handles is an id it cannot get wrong, so this takes whatever the person
 * called the trip — the id, the title, half the title — and resolves it here,
 * the way `read_day` already resolves a date.
 *
 * Exact id first, so nothing that used to work stops. Then the title, then a
 * prefix, then anything containing it, newest first at every step.
 *
 * **A name matching none of those resolves to nothing** — B940. It used to
 * fall through to the newest trip, and that is the one case where falling
 * through is wrong: somebody who asked for a day in their *Antarctica
 * Expedition*, in a journal whose only trip was a week in Tokyo, was shown a
 * filled-in proposal for Tokyo and told nothing about it. Nothing was written,
 * because nobody pressed it — but it was ready to be.
 *
 * The fallback is kept for an **omitted** name, which is what B927 is actually
 * about: a person mid-write-up means the trip they are writing up. And the
 * four steps above already catch what B927 added it for — a model shortening
 * `georgia-2026` to `georgia` is a prefix, not a miss. What was left for the
 * fallback to catch is a name that means nothing in this journal, which is
 * exactly the name that must not quietly become a different trip.
 */
function resolveTrip(username: string, id?: string) {
  // One, or none. Two trips answering to the same words is not an answer, and
  // taking the first is how the older of them became unreachable — B965.
  const fits = resolveTrips(username, id);
  return fits.length === 1 ? fits[0] : undefined;
}

/**
 * Every trip a name fits, at the best step it fits any — B965.
 *
 * B940 stopped a name that matches **nothing** from resolving to the newest
 * trip. A name that matches **several** still did, silently: `Balkan` is a
 * prefix of both `balkan-loop-2026` and `balkan-loop-check`, so the older was
 * unreachable by that word and nobody was told there had been a choice.
 *
 * Five of six forms resolved correctly in the journal that found this. The
 * sixth is the one where somebody writes a day into the wrong trip, and it is
 * the case where they were least specific and so least likely to check.
 *
 * **The step matters and the tie is only within it.** An exact id still beats
 * a title that also matches, and a title still beats a substring: *"Danube
 * Circuit"* is not ambiguous because *"Danube"* also fits something else. What
 * is ambiguous is two trips answering equally well to the same words.
 */
function resolveTrips(username: string, id?: string) {
  const trips = [...getTrips(username)].sort((a, b) => b.start.localeCompare(a.start));
  const said = flatten(id ?? "");
  if (said === "") return trips.slice(0, 1);

  const exact = trips.filter((one) => one.id === id?.trim());
  if (exact.length > 0) return exact;

  for (const fits of [
    (one: (typeof trips)[number]) => flatten(one.id) === said,
    (one: (typeof trips)[number]) => flatten(one.title) === said,
    (one: (typeof trips)[number]) =>
      flatten(one.id).startsWith(said) || flatten(one.title).startsWith(said),
    (one: (typeof trips)[number]) =>
      flatten(one.id).includes(said) || flatten(one.title).includes(said),
  ]) {
    const found = trips.filter(fits);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * Why a trip did not resolve, in words the model can repeat — B940.
 *
 * All four reads answered "there are no trips in this journal", which stops
 * being true the moment a *name* misses in a journal that has several. Being
 * told there are no trips when there are three is being told something false
 * about your own journal, and it is the answer a person is least able to
 * argue with.
 */
function noTrip(username: string, said?: string) {
  // Two trips answering to the same words is a different answer from none —
  // B965. Naming them is the whole of it: the person knows which they meant.
  const fits = resolveTrips(username, said);
  if (fits.length > 1) {
    return {
      found: false,
      why: `"${said?.trim()}" fits more than one trip — ${fits
        .map((one) => `${one.title} (${one.id})`)
        .join(" and ")}: ask which they mean and do not choose for them`,
    };
  }
  return {
    found: false,
    why:
      said && said.trim() !== "" && getTrips(username).length > 0
        ? `there is no trip called "${said.trim()}" here: say so, and ask which of their trips they mean`
        : "there are no trips in this journal",
  };
}

const TRIP_ARG = {
  trip: {
    type: "string" as const,
    // B927 — never an id the model composed. What the person called it is
    // resolved here against the trips that exist.
    description:
      "The trip as they name it — its title, or part of it. Never invent an id. Omit for the newest.",
  },
};

const DAY_ARGS = {
  ...TRIP_ARG,
  slug: { type: "string" as const, description: "The day's slug, if one is known." },
  date: { type: "string" as const, description: "The day, as YYYY-MM-DD." },
};

/** How much of a day's own words travel back to the screen in a preview. */
const PREVIEW_CHARACTERS = 600;

/** The day a slug or a date names, or the newest draft when neither is given
 *  — the day somebody mid-write-up means. */
function resolveDay(username: string, args: Record<string, string>) {
  const trip = resolveTrip(username, args.trip);
  if (!trip) return null;
  const entries = getAllEntries(trip.ref, AS_AUTHOR);
  const bySlug = args.slug ? entries.find((entry) => entry.slug === args.slug) : undefined;
  if (bySlug) return { trip, entry: bySlug, guessed: false };
  /**
   * **A date nobody wrote a day for is not the newest day** — B925.
   *
   * "Put these on yesterday", where yesterday has no day yet, used to fall
   * through to whatever was written last: a proposal about the wrong day, or
   * — when the trip had no days at all — a proposal with an empty slug, which
   * is the `unknown_day` the press came back with. Saying there is no such day
   * is the honest answer, and `proposalFor` below makes sure there is nothing
   * to press when there is nothing to press it on.
   */
  if (args.date) {
    const onDate = entries.find((entry) => entry.date === args.date);
    return onDate ? { trip, entry: onDate, guessed: false } : null;
  }
  /**
   * The newest day, **and it says that it guessed** — B954.
   *
   * Somebody writing up a three-week trip months later said *"the last one"*,
   * meaning the flight home, which had no day yet. This returned the Alhambra
   * draft — the most recently written — and `set_day_words` built a
   * confidently worded, filled-in proposal to overwrite that day's words with
   * the flight-home narrative. Then *"the rainy one"*, about a day never
   * mentioned, resolved to an existing Seville day the same way.
   *
   * The default is still right, and this is why it is a flag rather than a
   * deletion: somebody who has just started a day and says "now the words"
   * means that day, and asking them which would be absurd. What is not right
   * is a **guess** standing behind a write that replaces what is already
   * there. `guessed` is how the tool that overwrites can tell the two apart.
   */
  const newest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  return newest ? { trip, entry: newest, guessed: true } : null;
}

/**
 * The trip a proposal is about, even when the day is not there — B925.
 *
 * `resolveDay` answers null for a date nobody has written, and the trip field
 * used to fall back to whatever the model typed: a proposal about a day that
 * does not exist reported a trip that does not exist either, and the sentence
 * a person read named the wrong missing half.
 *
 * It no longer falls back to `args.trip` at all — B940. An unresolved
 * name is a name for no trip here, and putting it in the field would
 * send it to a route that answers `unknown_trip`. Empty is what reaches
 * the "nothing was proposed" path in `runTool`, which asks.
 */
function tripIdFor(
  username: string,
  args: Record<string, string>,
  found: { trip: { id: string } } | null,
): string {
  return found?.trip.id ?? resolveTrip(username, args.trip)?.id ?? "";
}

/**
 * Who will be able to read this trip once a day of it is on the site — B933.
 *
 * The people rather than the vocabulary, and a count only where the people
 * are not the owner's to name: a journal's guests are approved one at a time
 * on the contacts page and are not the trip's business, while the people on a
 * trip are written into `trip.md` by hand and are exactly who it says.
 */
async function readersOf(username: string, tripId: string, say: Say): Promise<string> {
  const trip = getTrip(tripRef(username, tripId));
  if (!trip) return "";
  if (trip.visibility === "public") return say("agent.tool.publishReadersPublic");
  if (trip.visibility === "guest") {
    const approved = isEnabled("contacts", username)
      ? (await listContacts(username)).filter((one) => one.approvedAt !== null).length
      : 0;
    return approved === 0
      ? say("agent.tool.publishReadersGuestNobody")
      : say("agent.tool.publishReadersGuest", { count: String(approved) });
  }
  const named = trip.people.map((one) => one.name).filter((name) => name !== "");
  return named.length === 0
    ? say("agent.tool.publishReadersPrivateNobody")
    : say("agent.tool.publishReadersPrivate", { people: named.join(", ") });
}

/**
 * The first day of a trip nobody has written yet — B818.
 *
 * **Not today.** Somebody writing up a trip is behind it, not on it: the day
 * they mean is the earliest one with nothing on it, and defaulting to today
 * was how a person on the road ended up with a day for a date they had not
 * reached. Every day written and the trip still running: the day after the
 * last one written, clipped to the trip.
 */
function firstUnwritten(username: string, tripId: string, today: string): string {
  const trip = resolveTrip(username, tripId);
  if (!trip) return today;
  const written = new Set(getAllEntries(trip.ref, AS_AUTHOR).map((entry) => entry.date));
  const last = today < trip.end ? today : trip.end;
  for (let at = new Date(`${trip.start}T00:00:00Z`); ; at.setUTCDate(at.getUTCDate() + 1)) {
    const date = at.toISOString().slice(0, 10);
    if (date > last) break;
    if (!written.has(date)) return date;
  }
  return last;
}

export const TOOLS: readonly Tool[] = [
  {
    name: "trips",
    kind: "read",
    renders: "choose",
    describe: "Every trip in this journal: its id, title and the days it runs between.",
    properties: {},
    run: async (username) =>
      getTrips(username)
        .map((trip) => ({ id: trip.id, title: trip.title, start: trip.start, end: trip.end }))
        .sort((a, b) => b.start.localeCompare(a.start)),
    block: (data, say) => {
      const trips = data as { id: string; title: string; start: string; end: string }[];
      if (trips.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.trips"),
        options: trips.map((trip) => ({
          value: trip.id,
          label: trip.title,
          detail: `${trip.start} – ${trip.end}`,
        })),
      };
    },
  },
  {
    name: "days",
    kind: "read",
    renders: "choose",
    describe:
      "The days of one trip: the date, what each is called, and whether it is on the site or still a draft.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      return getAllEntries(trip.ref, AS_AUTHOR).map((entry) => ({
        trip: trip.id,
        date: entry.date,
        slug: entry.slug,
        title: entry.title,
        draft: Boolean(entry.draft),
        photos: entry.gallery.length,
      }));
    },
    block: (data, say) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const days = data as { date: string; slug: string; title: string; draft: boolean }[];
      return {
        shape: "choose",
        text: say("agent.block.days"),
        options: days.map((day) => ({
          value: day.slug,
          label: day.title,
          detail: day.date,
        })),
      };
    },
  },
  {
    name: "unfinished",
    kind: "read",
    renders: "choose",
    describe:
      "The days started and not yet published — what is waiting, which trip and date each belongs to, whether it has photographs and whether the words are written.",
    properties: {},
    run: async (username) => draftsForWizard(username),
    block: (data, say) => {
      const days = data as { trip: string; slug: string; date: string; title: string }[];
      if (days.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.unfinished"),
        options: days.map((day) => ({
          value: `${day.trip}/${day.slug}`,
          label: day.title,
          detail: day.date,
        })),
      };
    },
  },
  {
    name: "read_day",
    kind: "read",
    renders: "preview",
    describe:
      "One day of a trip: its title, its slug, whether it is published, how many photographs it carries and the words on it.",
    properties: {
      ...TRIP_ARG,
      date: { type: "string", description: "The day, as YYYY-MM-DD." },
    },
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      const entries = getAllEntries(trip.ref, AS_AUTHOR).filter(
        (entry) => !args.date || entry.date === args.date,
      );
      if (entries.length === 0) return { found: false, trip: trip.id, why: "no day on that date" };
      return entries.map((entry) => ({
        trip: trip.id,
        date: entry.date,
        slug: entry.slug,
        title: entry.title,
        draft: Boolean(entry.draft),
        photos: entry.gallery.length,
        words: entry.content,
      }));
    },
    block: (data, say) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const day = data[0] as { date: string; title: string; words: string };
      return {
        shape: "preview",
        text: say("agent.block.day"),
        // The day's own words and the day's own date: nothing here needs
        // translating, because none of it is this software's prose.
        lines: [day.date, day.title, day.words.slice(0, PREVIEW_CHARACTERS)].filter(
          (line) => line !== "",
        ),
      };
    },
  },
  {
    /** Credits and disk in one answer — the two questions about the account
     *  itself, which nobody asks one at a time. */
    name: "account",
    kind: "read",
    renders: "say",
    describe:
      "This journal's own account: credits left, and disk space used out of what it may. Credits pay for the model, captions, transcription and printing. A null balance means this server charges for nothing. Bytes only — never where anything is.",
    properties: {},
    run: async (username) => {
      const usage = await storageFor(username);
      return {
        credits: await balanceOf(username),
        used: formatBytes(usage.usedBytes),
        limit: usage.limitBytes === null ? null : formatBytes(usage.limitBytes),
        left: usage.remainingBytes === null ? null : formatBytes(usage.remainingBytes),
      };
    },
  },
  {
    name: "trip_costs",
    kind: "read",
    renders: "say",
    describe:
      "What a trip has cost so far: the total, what was spent preparing, the daily average, and the largest categories. Every figure is in the journal's own currency. `notInTheTotal` is money it could not convert and left out: if it is not empty, say so and how much.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      /**
       * **The owner's own money, read as the owner** — B959.
       *
       * This read the trip as an anonymous visitor, so costs on a day still in
       * draft were invisible — in the owner's own conversation, about their
       * own spend. Every other read tool in this file passes `AS_AUTHOR`; this
       * one did not, and the write-up case is exactly the one it breaks:
       * somebody logging what they spent as they write, before publishing.
       *
       * Three answers in one session, all false: *"the total is 0 CHF because
       * nothing has been saved yet"* with two costs on disk, *"nothing has
       * been recorded yet"* with four, and *"31 CHF"* with six — the two that
       * happened to be on published days.
       *
       * B955 made the model call this tool instead of adding up itself, which
       * was right and which made this worse in one exact way: a wrong sum it
       * derived looks second-guessable, and a wrong sum from the tool that
       * reads the disk does not.
       */
      const costs = getCostSummary(tripRef(username, trip.id), new Date(), AS_AUTHOR);
      return {
        trip: trip.id,
        currency: costs.baseCurrency,
        total: costs.total,
        preparation: costs.preparation,
        onTheRoad: costs.onTheRoad,
        perDay: costs.perDay,
        // B560 — a day nobody wrote costs down for reads as a zero, so the
        // total is a floor rather than a figure and the model must be able
        // to say so.
        daysWithNothingRecorded: costs.unrecordedDays,
        /**
         * **What the total does not include** — B960.
         *
         * A trip's `rates:` block is what converts foreign spend into the
         * journal's own currency, and `add_cost` never writes one — so a trip
         * built entirely through the conversation has none, and every cost in
         * anything but the base currency is left out of `total`.
         *
         * Six costs in three currencies came back as *"Total for the trip so
         * far: 31 CHF"*, being the two in CHF. Real spend was over two hundred
         * at any plausible rate, and nothing said a word.
         *
         * `getCostSummary` has known this all along — `unconverted` is its
         * own field and this tool simply dropped it, so even a model inclined
         * to mention it had nothing to mention. A total that admits to being
         * partial is honest; one that cannot is the shape of every fault found
         * this week.
         *
         * Where a rate should come *from* is a real decision and is not this:
         * converting at a rate nobody chose is exactly the invention this
         * codebase refuses everywhere else.
         */
        notInTheTotal: costs.unconverted.map((one) => ({
          currency: one.currency,
          amount: one.amount,
          items: one.count,
        })),
        byCategory: costs.byCategory.map((one) => ({
          category: one.category,
          amount: one.amount,
        })),
      };
    },
  },
  {
    name: "who_can_read",
    kind: "read",
    renders: "say",
    describe:
      "Who a trip is open to: public (everybody), guest (everybody let into this journal) or private (only the people who were on it), whether it is advertised, and how many people are named on it.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      const full = getTrip(tripRef(username, trip.id));
      if (!full) return { found: false, why: "that trip could not be read" };
      /**
       * **The people, not the vocabulary** — B933.
       *
       * This used to answer `visibility: "guest", peopleNamed: 0` and leave
       * the model to turn that into a sentence, which is how *"nur Sie und
       * Ihre Tochter können sie sehen"* was said about a trip her daughter
       * could not open (B931). Every persona in this project has asked some
       * version of *"can my mother read this"*, and the honest answer has
       * always needed either a route call or a leap of faith.
       *
       * Names come from the file, which is the owner's own editorial
       * statement about whose trip it was. **Addresses never do**: an email
       * in a tool result is an email in the prompt, and nobody asked for
       * their address to be read out because somebody wondered who could
       * read a day.
       */
      const approved = isEnabled("contacts", username)
        ? (await listContacts(username)).filter((one) => one.approvedAt !== null).length
        : 0;
      return {
        trip: full.id,
        visibility: full.visibility,
        listed: full.listed,
        teaser: Boolean(full.teaser),
        peopleNamed: full.people.length,
        // Who they are, by the name the owner wrote down.
        people: full.people.map((one) => one.name).filter((name) => name !== ""),
        /**
         * How many people have been let into the **journal**, which is what a
         * `guest` trip is open to. Nought here is the whole of B931: a trip
         * set to `guest` so that one named person could read it, and nobody
         * approved, reads to somebody as "my daughter can see it" and is not.
         */
        guestsApprovedIntoJournal: approved,
        contactsOff: !isEnabled("contacts", username),
      };
    },
  },
  {
    /**
     * The first write tool, and it writes nothing.
     *
     * **Visibility is a field rather than a default**, and the three labels
     * are sentences rather than words: the mistake a person makes at exactly
     * this moment is answering "who can see it" with the wrong one of *guest*
     * and *private*, and the difference — everybody I let into this journal,
     * against only the people who were there — cannot be carried by the word
     * alone. It is prefilled with what the journal's own default would be, and
     * it is on the screen to be read before the press.
     */
    name: "create_trip",
    kind: "write",
    renders: "form",
    describe:
      "Propose a new trip — a journey with a title, a first and last day, and who may read it. This creates nothing: it fills the fields in and the person presses. Never say in your own words who can read it — the field's labels do.",
    properties: {
      title: { type: "string", description: "What the trip is called, in the writer's own words." },
      start: { type: "string", description: "The first day, as YYYY-MM-DD." },
      end: { type: "string", description: "The last day, as YYYY-MM-DD." },
      visibility: {
        type: "string",
        description:
          "Who may read it: public (anybody), guest (everybody let into this journal), private (ONLY the people who were on the trip). A person they name is a guest — \"only my daughter should read this\" is guest; private shuts her out. Leave it out unless they said.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip`,
    propose: async (_username, args, say) => ({
      /**
       * The sentence, and then the line about who may read it — B923.
       *
       * *"nur meine Tochter soll das lesen können"* came back proposing
       * `private`, which means the people who were on the trip and would have
       * shut her daughter out; the model's own prose said the opposite of the
       * label beside it. The label is the whole safety here, so the sentence
       * points at it rather than paraphrasing it, and the tool tells the model
       * not to describe who can read a trip in words of its own.
       */
      sentence: `${say("agent.tool.createTrip", {
        title: args.title ?? "",
        start: args.start ?? "",
        end: args.end ?? "",
      })} ${say("agent.tool.createTripVisibility")}`,
      accept: say("agent.tool.createTripAccept"),
      done: say("agent.tool.createTripDone"),
      fields: [
        { name: "title", value: args.title ?? "" },
        { name: "start", value: args.start ?? "", date: true },
        { name: "end", value: args.end ?? "", date: true },
        {
          name: "visibility",
          value: ["public", "guest", "private"].includes(args.visibility ?? "")
            ? args.visibility
            : "guest",
          options: [
            { value: "public", label: say("agent.tool.visibilityPublic") },
            { value: "guest", label: say("agent.tool.visibilityGuest") },
            { value: "private", label: say("agent.tool.visibilityPrivate") },
          ],
        },
      ],
    }),
  },
  {
    /**
     * The day itself, started — B818 is the date.
     *
     * **The default is the first day nobody has written, not today.** A person
     * writing up a trip is behind it; today is the one date they are least
     * likely to mean, and it was the one the wizard opened on.
     */
    name: "start_day",
    kind: "write",
    renders: "form",
    describe:
      "Propose starting a day of a trip — an empty day with a date, ready for words and photographs. Nothing is created until they press. Leave the date out and it fills in the first day of the trip nobody has written yet.",
    properties: {
      ...TRIP_ARG,
      date: { type: "string", description: "The day, as YYYY-MM-DD. Omit to use the first unwritten day." },
      /**
       * What they said about the day, when they said it all at once — B969.
       *
       * The commonest thing anybody does here is describe a day in a sentence,
       * and the day usually does not exist yet. The whole paragraph used to be
       * dropped: four times out of four in an ordinary write-up, somebody was
       * told to press a button and then say it all again.
       */
      notes: {
        type: "string",
        description:
          "Anything they already said about the day, in their own words. Pass it through when they described the day while asking for it: it rides to the next card and is not written here. Never write it yourself.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day`,
    propose: async (username, args, say, today) => {
      const trip = resolveTrip(username, args.trip);
      const date = args.date ?? firstUnwritten(username, trip?.id ?? "", today);
      /**
       * The trip's own questions, on the proposal — B917.
       *
       * `POST .../day` refuses a day that says nothing about what its trip
       * keeps (`lib/tracks.ts`), and the conversation had no way to answer:
       * every press came back `incomplete_day`. So the questions are fields
       * like any other, and they open on `unknown` — which is not a guess but
       * the literal state of affairs, exactly as B810 decided for the wizard's
       * express path: money was spent and nobody has told this journal the
       * figures. Nothing is invented; nobody has been asked yet. A real
       * figure is `add_cost` afterwards, and the sentence says so.
       *
       * Only the `write` rows: `photos` is asked at publish, and there is no
       * photograph at creation for anybody to answer about.
       */
      const asked = TRACKS.filter(
        (row) => TRACK_ROWS[row].when === "write" && (trip?.tracks ?? ALL_TRACKED)[row],
      );
      const sentence = say("agent.tool.startDay", {
        date,
        trip: trip?.title ?? "",
      });
      /**
       * **Their words, carried across the press** — B969.
       *
       * `POST .../day` makes an empty day and cannot hold prose, which is
       * right: writing and reading back are two steps here as they are
       * everywhere else. What was missing is that the notes somebody had
       * *already given* went nowhere, so they typed their paragraph, pressed,
       * and typed it again.
       *
       * `next` is the mechanism `draft_words` already uses to hand its prose
       * to `set_day_words`. The browser carries this proposal's own arguments
       * into the next one, so the notes ride along and the trip and slug come
       * from what the route actually wrote.
       *
       * Only when there are notes. A card offering to spend a credit writing
       * up an empty day is worse than no card.
       */
      const carryOn = (args.notes ?? "").trim() !== "";
      return {
        ...(carryOn
          ? { next: { tool: "draft_words", from: { trip: "trip", slug: "slug" } } }
          : {}),
        sentence: asked.length > 0 ? `${sentence} ${say("agent.tool.startDayUnknown")}` : sentence,
        accept: say("agent.tool.startDayAccept"),
        done: say("agent.tool.startDayDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          { name: "date", value: date, date: true },
          ...asked.map((row) => ({
            name: row,
            value: UNKNOWN,
            options: [
              { value: UNKNOWN, label: say("agent.answerUnknown") },
              { value: "none", label: say("agent.answerNone") },
            ],
          })),
        ],
      };
    },
  },
  {
    /**
     * The one tool that spends a credit, and it spends it on the press.
     *
     * It writes nothing either: `POST .../day/write-day` returns prose to be
     * read, and keeping it is `set_day_words` — a second proposal and a second
     * press, which is `next`. The person reads what came back before any of it
     * is in their journal, which is what makes the "write only what you were
     * told" rule checkable rather than merely stated.
     */
    name: "draft_words",
    kind: "write",
    renders: "form",
    describe:
      "Propose turning their own notes about a day into a title and a few paragraphs. Nothing is written and nothing is spent until they press; what comes back is shown to them to read, change or throw away. It costs one credit.",
    properties: {
      ...DAY_ARGS,
      notes: {
        type: "string",
        description:
          "Their own notes about the day, in their own words, exactly as they said them. Never write these yourself and never add anything they did not say.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/write-day`,
    // What came back is prose to read, not a day. Keeping it is the second
    // proposal and the second press: `draft.prose` is what the write-day
    // route calls the words.
    next: { tool: "set_day_words", from: { title: "draft.title", content: "draft.prose" } },
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        sentence: say("agent.tool.draftWords", { credits: "1" }),
        accept: say("agent.tool.draftWordsAccept"),
        done: say("agent.tool.draftWordsDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "date", value: found?.entry.date ?? args.date ?? "", date: true },
          { name: "notes", value: args.notes ?? "", long: true },
        ],
      };
    },
  },
  {
    name: "set_day_words",
    kind: "write",
    renders: "form",
    describe:
      "Propose the title and the words of a day that already exists. Use their own words, never yours. Nothing is saved until they press, and a day already on the site stays on the site. Also how a wrong word on a day is corrected.",
    properties: {
      ...DAY_ARGS,
      title: { type: "string", description: "The day's title, short, from what they said." },
      content: { type: "string", description: "The day's words, in their language, as they said them." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        /**
         * **A guess may not overwrite what is already written** — B954.
         *
         * `resolveDay` falls back to the newest day when nothing names one,
         * and that is right for the ordinary flow: somebody who has just
         * started a day and says "now the words" means that day. It is not
         * right when the day it landed on already has prose and nobody said
         * which day — that is somebody's writing replaced on a guess, by a
         * press this card invited them to make.
         *
         * The distinction is the day's own state rather than the phrasing:
         * filling an empty day costs nothing if it is the wrong one, and it
         * is the case the fallback exists for.
         */
        ...(found?.guessed && found.entry.content.trim() !== ""
          ? { refuse: "agent.tool.whichDayToRewrite" }
          : {}),
        sentence: say("agent.tool.setWords", { date: found?.entry.date ?? args.date ?? "" }),
        accept: say("agent.tool.setWordsAccept"),
        done: say("agent.tool.setWordsDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "title", value: args.title ?? found?.entry.title ?? "" },
          /**
           * What the day already says, when nothing was proposed — B942.
           *
           * It opened on nothing, under a sentence saying it would set the
           * day's words — and no press of it could succeed, because
           * `lib/api/entries.ts` refuses empty content. B929's shape again: a
           * proposal on somebody's screen that nothing can accept.
           *
           * It is also what makes a correction possible at all (B941). A
           * person saying "it should say udon, not ramen" is editing one word
           * of a paragraph, and the model had to reproduce the whole
           * paragraph from memory to do it — expensive, easy to get wrong,
           * and the reason it reached for a different tool instead.
           *
           * A day with no words at all stays refused, which is right: that
           * is not an edit, it is deleting the day.
           */
          { name: "content", value: args.content ?? found?.entry.content ?? "", long: true },
        ],
      };
    },
  },
  {
    name: "add_cost",
    kind: "write",
    renders: "form",
    describe:
      "Propose one thing a day cost — what it was, how much, which category. Only ever a figure they gave you. Nothing is recorded until they press. Never to correct a day's words: that is set_day_words.",
    properties: {
      ...DAY_ARGS,
      label: { type: "string", description: "What it was, in their words." },
      amount: { type: "string", description: "How much, as a number. Never one you worked out." },
      currency: { type: "string", description: "The three-letter code, if they said one." },
      category: {
        type: "string",
        // B968 — the closed list, said out loud. It was described as "one of
        // the journal's own categories" without naming them, so the model
        // supplied "Food" and "Attractions" and every press came back
        // `invalid_cost`.
        description: `One of: ${COST_CATEGORIES.join(", ")}. Leave it out rather than guessing.`,
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/costs`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        sentence: say("agent.tool.addCost", {
          label: args.label ?? "",
          amount: args.amount ?? "",
        }),
        accept: say("agent.tool.addCostAccept"),
        done: say("agent.tool.addCostDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "date", value: args.date ?? found?.entry.date ?? "", date: true },
          { name: "label", value: args.label ?? "" },
          { name: "amount", value: args.amount ?? "" },
          { name: "currency", value: args.currency ?? "" },
          /**
           * **The closed list it always was** — B968.
           *
           * This drew whatever the model said, and the route accepts only the
           * lowercase members of `COST_CATEGORIES`. So `"Food"` and
           * `"Attractions"` reached somebody's screen as a filled-in field and
           * every press came back `invalid_cost` — B925's fault with the check
           * missing: a proposal no press can accept.
           *
           * `create_trip`'s `visibility` is the shape: matched against the
           * list, an unrecognised word dropped rather than guessed at, and
           * drawn as options so a person can correct it. Case-insensitively,
           * because the model's own capitalisation is not a decision anybody
           * made.
           */
          {
            name: "category",
            value:
              (COST_CATEGORIES as readonly string[]).find(
                (one) => one === args.category?.trim().toLowerCase(),
              ) ?? "",
            options: COST_CATEGORIES.map((one) => ({ value: one, label: one })),
          },
        ],
      };
    },
  },
  {
    /**
     * **A rendered day, and then one press.** The preview is not decoration
     * and not optional: publishing is the moment a day becomes readable by
     * other people, and the plan's rule is that it happens after somebody has
     * read it back — never from a sentence. There are no editable fields,
     * because there is nothing here to correct: a wrong day is corrected by
     * saying which day, and the next turn proposes that one.
     */
    name: "publish_day",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose putting a day on the site. This shows them the day as their readers will see it and stops; it publishes nothing. Only the button under it publishes.",
    properties: DAY_ARGS,
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/publish`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      /**
       * The publish-time questions, on the confirmation — B929, and B917's
       * fix at the other end of the day's life.
       *
       * `photos` is a `publish` row (`lib/tracks.ts`), so nothing before this
       * moment could answer it and the press came back `incomplete_day` every
       * time. Whatever the route is about to refuse is asked here instead —
       * `missingFrom` is the same function the route runs, so the two cannot
       * drift into asking different questions.
       *
       * They open on `unknown`, which is not a guess: nobody has been asked
       * yet, and "there are pictures somewhere and nobody has them to hand"
       * is the true thing to write. **They are not in `properties`**, so the
       * model cannot answer them on somebody's behalf; only the person's own
       * select does.
       */
      const asked = found
        ? missingFrom(factsOfEntry(found.entry), found.trip.tracks, "publish").map((row) => row.field)
        : [];
      /**
       * **Who will be able to read it, in the same breath as the button** —
       * B933, and it is the sentence this whole product is for.
       *
       * She could only find out that her daughter had no access by reading
       * `people: []` and `invites: []` out of the API. Every persona here has
       * asked some version of *"can my mother read this"*, and the answer has
       * always cost either a route call or a leap of faith — which is exactly
       * how B931 happened: a trip set to `guest` so one named person could
       * read it, nobody approved, and the model saying she could.
       *
       * Before the press rather than after it. Publishing is the moment a day
       * becomes readable by other people, and the audience is the thing a
       * person is actually consenting to.
       *
       * It says **nought as a sentence**, never as a number: "only you, and
       * you have not let anybody in yet" is the reading that would have
       * caught B931 without an agent.
       */
      const audience = found ? await readersOf(username, found.trip.id, say) : "";
      const sentence = found
        ? `${say("agent.tool.publishDay", { date: found.entry.date, title: found.entry.title })} ${audience}`
        : say("agent.tool.publishNoDay");
      return {
        sentence:
          asked.length > 0 ? `${sentence} ${say("agent.tool.publishDayUnknown")}` : sentence,
        accept: say("agent.tool.publishDayAccept"),
        done: say("agent.tool.publishDayDone"),
        preview: found
          ? [found.entry.date, found.entry.title, found.entry.content.slice(0, PREVIEW_CHARACTERS)].filter(
              (line) => line !== "",
            )
          : [],
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          ...asked.map((row) => ({
            name: row,
            value: UNKNOWN,
            options: [
              { value: UNKNOWN, label: say("agent.answerUnknown") },
              { value: "none", label: say("agent.answerNone") },
            ],
          })),
        ],
      };
    },
  },
  {
    /**
     * The takedown, and **it is not a delete** (B816).
     *
     * The day goes back to being a draft: off the site, off the feed, still on
     * disk with every photograph attached, and publishing it again is the
     * undo. Nothing in this registry deletes anything, and the words that mean
     * *destroy* are refused before a model is asked at all.
     */
    name: "unpublish_day",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose taking a day back off the site. It becomes a draft again — nothing is deleted, every photograph stays, and publishing it again puts it back. Nothing happens until they press.",
    properties: DAY_ARGS,
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/unpublish`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        /**
         * A day that was never up does not come down — B951.
         *
         * `publish_day` has always refused a day that is already published;
         * its mirror had no such check, so asking to take down a draft
         * produced a confirmation card saying it *"comes off the site and
         * goes back to being a draft"* about a day that had never been on the
         * site. The press would have answered `already_draft`; the sentence
         * she read before pressing said her day was live.
         */
        ...(found?.entry.draft ? { refuse: "agent.tool.alreadyDraft" } : {}),
        sentence: found
          ? say("agent.tool.unpublishDay", { date: found.entry.date, title: found.entry.title })
          : say("agent.tool.publishNoDay"),
        accept: say("agent.tool.unpublishDayAccept"),
        done: say("agent.tool.unpublishDayDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
        ],
      };
    },
  },
  {
    /**
     * The photographs already waiting, put on a day — B915.
     *
     * The one sentence the files pane exists for. A person ticks two
     * photographs in the inbox and says "put these on yesterday"; the ids ride
     * into the conversation on the selection line (`describeSelection`,
     * lib/helper/server.ts), and this proposes the move — the files named, the
     * day named, and nothing moved until the press.
     *
     * **It does not upload anything**, which is why `add_photos` below still
     * exists and still hands over the day's own page: bytes from a camera are
     * a picker and a file input, and neither is a sentence. This moves files
     * this journal already has, through the same
     * `attachStagedFiles` the documented v1 route calls, so the same
     * duplicate rule holds at both doors — the inbox names a file by a hash of
     * its bytes, so the same photograph offered twice is recognised rather
     * than stored again.
     */
    name: "attach_files",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose putting photographs waiting in the inbox onto a day — \"put these on yesterday\", about the files pane. Leave `files` out: what they ticked is known here. Never ask them for an id.",
    properties: {
      ...DAY_ARGS,
      files: {
        type: "string",
        description: "Omit it: the ticked files are used.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/attach`,
    propose: async (username, args, say, _today, selected) => {
      const found = resolveDay(username, args);
      /**
       * **The selection is resolved here, not read out by a person** — B925.
       *
       * The browser sends what is ticked on every turn. It used to reach the
       * tool only as a sentence in the model's context, so a model that did
       * not copy the ids asked *them* for ids — which appear nowhere on the
       * screen. What the model says is used when it says something; otherwise
       * the tick is the answer.
       */
      const asking =
        (args.files ?? "").trim() !== ""
          ? (args.files ?? "").split(",")
          : selected.filter((id) => id.startsWith("inbox:")).map((id) => id.slice("inbox:".length));
      // Resolved against disk, here as well as in the route: an id is a
      // reference and never a fact, and a proposal must name the files a
      // person will actually get rather than the ones a model typed.
      const names: string[] = [];
      const ids: string[] = [];
      for (const asked of asking) {
        const staged = findInboxFile(username, asked.trim());
        if (!staged || staged.entry.kind !== "media") continue;
        names.push(staged.entry.filename);
        ids.push(staged.entry.id);
      }
      // Either both or neither: a day with no files and files with no day are
      // the same refusal, and it says so rather than proposing half a move.
      const onto = names.length > 0 ? found : null;
      return {
        sentence: onto
          ? say("agent.tool.attachFiles", {
              count: String(names.length),
              date: onto.entry.date,
              title: onto.entry.title,
            })
          : say("agent.tool.attachNone"),
        accept: say("agent.tool.attachFilesAccept"),
        done: say("agent.tool.attachFilesDone"),
        // The files by name, and the day they are going on, before the press.
        // Their own filenames: nothing here is this software's prose.
        preview: onto ? [`${onto.entry.date} — ${onto.entry.title}`, ...names] : [],
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "files", value: ids.join(",") },
        ],
      };
    },
  },
  {
    /**
     * Letting somebody read it — B931, and the half of that ticket that makes
     * the other half sayable.
     *
     * *"nur meine Tochter soll das lesen können"* had no answer here at all.
     * There was no invite tool, so the only thing the conversation could do
     * with a named person was set a visibility — and `private` means the
     * people who were on the trip, which is precisely the value that shuts
     * out somebody who stayed at home. The model said her daughter could read
     * it. Her daughter could not.
     *
     * **A guest link and a buddy link are different things and do not share a
     * tool.** Only the guest one is here: a guest link belongs in a family
     * group chat, a buddy link is write access to a trip and belongs on the
     * contacts page. `components/InviteToRead.tsx` draws the same line on the
     * day page for the same reason, and there is no `kind` argument for a
     * model to get wrong.
     *
     * **It grants nothing**, and the sentences say so rather than softening
     * it: whoever opens the link proves their own address and lands in the
     * owner's queue. `approveContact` is still the only thing in this
     * codebase that writes a grant, and the answer after the press is "they
     * can now ask", never "they now have access".
     */
    name: "invite_guest",
    kind: "write",
    renders: "form",
    describe:
      "Propose a link that lets somebody ask to read this journal — the answer when they name a person who should be able to read it. Nothing is made until they press, and it grants nothing even then: whoever opens it proves their own address and waits to be approved.",
    properties: {
      name: {
        type: "string",
        description:
          "Who the link is for, as they said it. It only says whose link it is; it lets nobody in.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/invite`,
    propose: async (_username, args, say) => ({
      sentence: say("agent.tool.inviteGuest"),
      accept: say("agent.tool.inviteGuestAccept"),
      done: say("agent.tool.inviteGuestDone"),
      fields: [{ name: "name", value: args.name ?? "" }],
    }),
  },
  {
    /**
     * Photographs are files, and files are not a sentence. The day's own page
     * has the picker, the upload and what the camera recorded; this hands
     * somebody to it, on the right day, and changes nothing. Choosing files
     * inside the conversation is round 6 of the plan.
     */
    name: "add_photos",
    kind: "link",
    renders: "link",
    describe:
      "Where photographs are added to a day — the picker, what the camera recorded, and the upload. Use this whenever they want to put pictures on a day. It only hands them the page.",
    properties: DAY_ARGS,
    link: (username, args, say) => {
      const query = new URLSearchParams(
        Object.entries({ trip: args.trip ?? "", slug: args.slug ?? "", date: args.date ?? "" }).filter(
          ([, value]) => value !== "",
        ),
      ).toString();
      return {
        text: say("agent.tool.addPhotos"),
        href: `/agent/${encodeURIComponent(username)}${query ? `?${query}` : ""}`,
        label: say("agent.tool.addPhotosLabel"),
      };
    },
  },
];

/** The list the model is shown, generated — because a hand-written menu goes
 *  stale the first afternoon. A write tool says so in its own `describe`, so
 *  the menu is honest about which of these end in a press. */
export function toolList(): string {
  return TOOLS.map((tool) => `- ${tool.name}: ${tool.describe}`).join("\n");
}

/** The same registry, as the arguments schemas the SDK wants. Kept here
 *  rather than in `./model.ts` so there is one place a tool is described. */
export function toolSchemas() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.describe,
    input_schema: {
      type: "object" as const,
      properties: tool.properties as Record<string, unknown>,
      required: [] as string[],
      additionalProperties: false,
    },
  }));
}

/** What one tool call produced: what the model reads, and what the person
 *  sees. A `say` read draws nothing of its own — the sentence is the model's. */
export type Ran = {
  ok: boolean;
  result: unknown;
  blocks: Block[];
  proposal?: Proposal;
};

/** The declared arguments, trimmed, with anything the tool did not declare
 *  dropped rather than shown to somebody as a prefilled field. */
function argumentsOf(tool: Tool, args: unknown): Record<string, string> {
  const given = (args ?? {}) as Record<string, unknown>;
  const strings: Record<string, string> = {};
  for (const key of Object.keys(tool.properties)) {
    const value = given[key];
    if (typeof value === "string" && value.trim() !== "") strings[key] = value.trim();
  }
  return strings;
}

/**
 * One write tool's proposal — B900, and **nothing here writes**.
 *
 * Exported because a proposal is asked for twice: once by the model, when it
 * decides a sentence means a write, and once by `POST .../proposal` when one
 * accepted write hands on to the next (`draft_words` → `set_day_words`). Both
 * end in the same fields on the same screen with the same button, which is
 * what stops a chain being a second, quieter way to write something.
 */
export async function proposalFor(
  username: string,
  tool: Extract<Tool, { kind: "write" }>,
  args: Record<string, string>,
  say: Say,
  today: string,
  selected: string[] = [],
): Promise<{ proposal?: Proposal; blocks: Block[] }> {
  const made = await tool.propose(username, args, say, today, selected);

  /**
   * **A proposal that cannot work is not offered** — B925, and B920's rule
   * applied to this side of the screen.
   *
   * Every route a press posts to needs the trip, the day and — for an attach
   * — the files. A field left empty because nothing resolved used to be
   * proposed anyway: the button was there, the sentence said the photographs
   * were going onto the day, and the press came back `unknown_day` with the
   * files still in the inbox. One check, in the one place every proposal is
   * built, so a tool cannot forget it: no button, and a sentence saying which
   * half is missing.
   */
  // The tool declining itself — B951, and it comes first: a day that is
  // already a draft is a better answer than "which day did you mean".
  if (made.refuse) {
    return { blocks: [{ shape: "say", text: say(made.refuse as Parameters<Say>[0]) }] };
  }

  const empty = (name: string) => made.fields.some((field) => field.name === name && field.value.trim() === "");
  const missing = empty("trip")
    ? "agent.tool.noTrip"
    : empty("slug")
      ? "agent.tool.noDay"
      : empty("files")
        ? "agent.tool.noFiles"
        : "";
  if (missing !== "") {
    return { blocks: [{ shape: "say", text: say(missing) }] };
  }

  const proposal: Proposal = {
    tool: tool.name,
    /**
     * **One representation of one call** — B935, B936.
     *
     * `arguments` used to be what the model typed and `fields` what the server
     * resolved, and the two disagreed the moment a tool did any work: the
     * trip arrived as *"Spaziergang am See"* where the route needs
     * `spaziergang-am-see-2026`, and `start_day`'s own questions (B917) were
     * on the card and in no argument at all. Pressing a proposal the way its
     * own `arguments` describe it came back `unknown_trip` or
     * `incomplete_day`; the browser only survived it because `HelperAsk`
     * merged the fields back in on the way out.
     *
     * So the fields win here, once, where every proposal is built: **what a
     * press sends is `arguments`**, resolved and complete, and `fields` is
     * the same call shown for correction rather than a second source of
     * truth. An argument no field carries — a `date` a slug already answers —
     * stays, because a field that is not drawn has nothing to say about it.
     *
     * `test/helper-proposal-arguments.test.ts` presses every write tool in
     * the registry with `arguments` and nothing else.
     */
    arguments: {
      ...args,
      ...Object.fromEntries(made.fields.map((field) => [field.name, field.value])),
    },
    sentence: made.sentence,
    fields: made.fields,
    endpoint: tool.endpoint(username),
    method: tool.method ?? "POST",
    accept: made.accept,
    done: made.done,
    // The proposal's own, then the tool's — B969.
    ...(made.next ?? tool.next ? { next: made.next ?? tool.next } : {}),
  };
  const blocks: Block[] = [];
  // The thing as it stands, and then the press — never the other way round.
  if (made.preview && made.preview.length > 0) {
    blocks.push({ shape: "preview", text: made.sentence, lines: made.preview });
  }
  blocks.push(
    tool.renders === "form"
      ? { shape: "form", text: made.sentence, fields: made.fields, proposal }
      : {
          shape: "confirm",
          text: made.sentence,
          // Only what has to be chosen — B929. `trip` and `slug` stay the
          // server's own answer about which day this is about.
          fields: made.fields.filter((field) => field.options),
          proposal,
        },
  );
  return { proposal, blocks };
}

/** The write tool of that name, or null — the propose route's own lookup, so
 *  a `next` naming a read or a tool nobody built lands nowhere. */
export function writeTool(name: string): Extract<Tool, { kind: "write" }> | null {
  const tool = TOOLS.find((one) => one.name === name);
  return tool && tool.kind === "write" ? tool : null;
}

/**
 * Run one tool the model asked for.
 *
 * An unknown name and a thrown read both come back as a value the model can
 * read rather than as an exception: a tool that fails is a fact about the
 * journal ("there are no trips"), and the turn should end in a sentence about
 * it rather than in a 502.
 *
 * `say` is passed in rather than imported so that a proposal's sentence and a
 * block's heading are in the reader's own language and this file holds no
 * English prose.
 */
export async function runTool(
  username: string,
  name: string,
  args: unknown,
  say: Say,
  today: string,
  /** What is ticked in the files pane — B925, resolved by the tool that needs
   *  it rather than read out to the model by a person. */
  selected: string[] = [],
): Promise<Ran> {
  const tool = TOOLS.find((one) => one.name === name);
  if (!tool) {
    return { ok: false, result: { error: `there is no tool called ${name}` }, blocks: [] };
  }
  const strings = argumentsOf(tool, args);

  if (tool.kind === "write") {
    // Nothing is executed. `propose` may read this journal to fill a field in
    // or to draw the day; there is no `run` on a write tool to call, and the
    // press is what posts to `endpoint`.
    const { proposal, blocks } = await proposalFor(username, tool, strings, say, today, selected);
    if (!proposal) {
      // Nothing resolved, so there is nothing to press — and the model is told
      // so in the same words the person is, rather than being left to say a
      // button is waiting further down the page (B920).
      return {
        // Not an error: the tool answered, and what it answered is that there
        // is nothing to propose. `ok: false` would be `is_error` on the model's
        // tool result, and this is a fact about the journal rather than a fault.
        ok: true,
        result: {
          proposed: false,
          wrote: false,
          tool: tool.name,
          why: "nothing was proposed and there is no button on their screen: say so, and ask which trip or which day they mean",
        },
        blocks,
      };
    }
    return {
      ok: true,
      // What the model reads back, so its own sentence can say a proposal is
      // waiting rather than claim the thing exists.
      result: { proposed: true, wrote: false, tool: tool.name, arguments: proposal.arguments },
      blocks,
      proposal,
    };
  }

  if (tool.kind === "link") {
    const { text, href, label } = tool.link(username, strings, say);
    return {
      ok: true,
      result: { link: href, wrote: false },
      blocks: [{ shape: "link", text, href, label }],
    };
  }

  try {
    const result = await tool.run(username, strings);
    const block = tool.block?.(result, say) ?? null;
    return { ok: true, result, blocks: block ? [block] : [] };
  } catch (thrown) {
    return { ok: false, result: { error: (thrown as Error).message }, blocks: [] };
  }
}

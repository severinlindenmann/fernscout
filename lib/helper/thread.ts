import "server-only";
import { balanceOf } from "../credits";
import { getCostSummary } from "../costs";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { formatBytes, storageFor } from "../storageQuota";
import { getTrip, getTrips, tripRef } from "../trips";
import { draftsForWizard } from "./server";

/**
 * The thread — B889, round 1 of `docs/plans/2026-09-07-helper-as-an-agent.md`.
 *
 * **A registry of rows can only answer what somebody wrote a row for.** Seven
 * rows is a menu with a text box in front of it, which is why four of the
 * owner's seven ordinary German sentences came back `unknown`. This file is
 * the other half: a list of *tools* the model may call, so a sentence nobody
 * anticipated is answered by the model choosing among reads rather than by
 * somebody having written a row for that sentence.
 *
 * **Every tool here reads. There is no write tool and there is no way to add
 * one by accident**: a `ReadTool.run` returns a value and the loop in
 * `./model.ts` puts it back into the conversation — nothing here is handed a
 * writer, and `test/helper-thread.test.ts` asserts the journal on disk is
 * byte-identical after a conversation. Round 2 is where a write becomes a
 * *proposal*; until then the honest answer to "add a photograph" is a
 * sentence naming the control that does it.
 *
 * **Nothing here reads `gps/`.** The store in `lib/gps/store.ts` is reachable
 * from no route and from no tool, and a coordinate must never travel to a
 * model in a tool result. What these tools return is what the owner's own
 * screen already shows them about their own journal.
 *
 * ## Where the conversation lives, and why it is a Map
 *
 * In this process's memory, keyed by journal, for half an hour.
 *
 * The precedent for not inventing storage is `./draft.ts`: there is no
 * wizard-position field anywhere, because the step is a function of the draft
 * on disk and a second copy of a fact disagrees with the first within a month.
 * That reasoning does not reach here — nothing on disk knows what somebody
 * said out loud thirty seconds ago — so the conversation has to be *held*. The
 * question is only where, and the three candidates each answer themselves:
 *
 * - **Not the database.** A table outlives the conversation. What a person
 *   typed at their journal on a Tuesday would then sit in a backup, in a
 *   restore drill and in an export, and nobody asked for it to be kept. It is
 *   the same reason sent mail moved out from under `content/` in B636.
 * - **Not under `content/`.** That tree is the owner's own content and B510
 *   put everything else out of it. Chatter is not content.
 * - **Memory, then**, which is what `lib/rateLimit.ts` already does for the
 *   same shape of transient fact. A deploy or a restart drops every
 *   conversation, and the whole cost of that is one repeated sentence.
 *
 * What is kept is the plain text of each turn and nothing else — no tool
 * calls, no tool results. Trimming a history that carries `tool_use` blocks
 * can orphan a `tool_result` and earn a 400; the answer already carries what
 * the tools said, and a turn of text is a twentieth of the tokens.
 */

/** One thing that was said, by one side. Deliberately not the SDK's
 *  `MessageParam`: this holds text and never a tool block. */
export type Turn = { role: "user" | "assistant"; text: string };

/**
 * How much of a conversation is remembered.
 *
 * Six exchanges. Beyond that a person is on a different subject, and every
 * remembered turn is paid for again on the next one.
 */
const MAX_TURNS = 12;

/** Half an hour of nothing said, and the conversation is over. Somebody
 *  returning after that is starting again, which is what they expect. */
const TTL_MS = 30 * 60 * 1000;

/** Above this many journals mid-conversation, the expired ones are swept.
 *  Same shape as `lib/rateLimit.ts`, for the same reason. */
const MAX_THREADS = 1000;

const threads = new Map<string, { turns: Turn[]; touched: number }>();

function sweep(now: number) {
  if (threads.size <= MAX_THREADS) return;
  for (const [key, thread] of threads) {
    if (now - thread.touched >= TTL_MS) threads.delete(key);
  }
}

/** What has been said in this journal's conversation so far, oldest first. */
export function history(username: string): Turn[] {
  const thread = threads.get(username);
  if (!thread) return [];
  if (Date.now() - thread.touched >= TTL_MS) {
    threads.delete(username);
    return [];
  }
  return thread.turns;
}

/**
 * Add an exchange to the conversation.
 *
 * **A refused sentence is never remembered**, and that is a gate rather than
 * tidiness: B817 keeps removal language away from the model by matching it
 * before the model is called, and a refused sentence written into the history
 * would reach the model on the *next* turn instead. The route calls this only
 * on a turn that was actually answered.
 */
export function remember(username: string, said: string, answered: string): void {
  const now = Date.now();
  const turns = [
    ...history(username),
    { role: "user" as const, text: said },
    { role: "assistant" as const, text: answered },
  ].slice(-MAX_TURNS);
  threads.set(username, { turns, touched: now });
  sweep(now);
}

/** End a conversation. Used by the tests, and by nothing else yet. */
export function forget(username: string): void {
  threads.delete(username);
}

/* -------------------------------------------------------------------------
 * The tools.
 *
 * Each is a function that already exists somewhere in this codebase, given a
 * name and a sentence the model reads. Adding a capability is a row here —
 * the same property the registry had, kept deliberately, because it is what
 * stops the prompt promising something nobody built.
 * ---------------------------------------------------------------------- */

type ReadTool = {
  name: string;
  describe: string;
  /** JSON Schema for the arguments. `{}` for a tool that takes none. */
  properties: Record<string, { type: "string"; description: string }>;
  run: (username: string, args: Record<string, string>) => Promise<unknown>;
};

/** The trip somebody means when they name one, or the newest when they do
 *  not — the same choice `what_is_my_trip` makes in `./intents.ts`. */
function resolveTrip(username: string, id?: string) {
  const trips = getTrips(username);
  if (id) {
    const named = trips.find((one) => one.id === id);
    if (named) return named;
  }
  return [...trips].sort((a, b) => b.start.localeCompare(a.start))[0];
}

const TRIP_ARG = {
  trip: { type: "string" as const, description: "The trip id. Omit for the newest trip." },
};

export const READ_TOOLS: readonly ReadTool[] = [
  {
    name: "list_trips",
    describe: "Every trip in this journal: its id, title and the days it runs between.",
    properties: {},
    run: async (username) =>
      getTrips(username)
        .map((trip) => ({ id: trip.id, title: trip.title, start: trip.start, end: trip.end }))
        .sort((a, b) => b.start.localeCompare(a.start)),
  },
  {
    name: "unfinished",
    describe:
      "The days started and not yet published — what is waiting, which trip and date each belongs to, whether it has photographs and whether the words are written.",
    properties: {},
    run: async (username) => draftsForWizard(username),
  },
  {
    name: "read_day",
    describe:
      "One day of a trip: its title, whether it is published, how many photographs it carries and the words on it.",
    properties: {
      ...TRIP_ARG,
      date: { type: "string", description: "The day, as YYYY-MM-DD." },
    },
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return { found: false, why: "there are no trips in this journal" };
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
  },
  {
    name: "trip_costs",
    describe:
      "What a trip has cost so far: the total, what was spent preparing, the daily average, and the largest categories. Every figure is in the journal's own currency.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return { found: false, why: "there are no trips in this journal" };
      const costs = getCostSummary(tripRef(username, trip.id));
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
        byCategory: costs.byCategory.map((one) => ({
          category: one.category,
          amount: one.amount,
        })),
      };
    },
  },
  {
    name: "storage",
    describe:
      "How much disk space this journal takes up and how much is left before its limit. Bytes only — never where a photograph or a day has got to.",
    properties: {},
    run: async (username) => {
      const usage = await storageFor(username);
      return {
        used: formatBytes(usage.usedBytes),
        limit: usage.limitBytes === null ? null : formatBytes(usage.limitBytes),
        left: usage.remainingBytes === null ? null : formatBytes(usage.remainingBytes),
      };
    },
  },
  {
    name: "credits",
    describe:
      "How many credits this journal has left. Credits pay for the things that cost money — writing a day up with the model, captions, transcription, printing. Null means this server charges for nothing.",
    properties: {},
    run: async (username) => ({ balance: await balanceOf(username) }),
  },
  {
    name: "who_can_read",
    describe:
      "Who a trip is open to: public (everybody), guest (everybody let into this journal) or private (only the people who were on it), whether it is advertised, and how many people are named on it.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return { found: false, why: "there are no trips in this journal" };
      const full = getTrip(tripRef(username, trip.id));
      if (!full) return { found: false, why: "that trip could not be read" };
      return {
        trip: full.id,
        visibility: full.visibility,
        listed: full.listed,
        teaser: Boolean(full.teaser),
        peopleNamed: full.people.length,
      };
    },
  },
];

/** The list the model is shown, generated — as `intentList()` is, and for the
 *  same reason: a hand-written menu goes stale the first afternoon. */
export function toolList(): string {
  return READ_TOOLS.map((tool) => `- ${tool.name}: ${tool.describe}`).join("\n");
}

/**
 * Run one tool the model asked for.
 *
 * An unknown name and a thrown read both come back as a value the model can
 * read rather than as an exception: a tool that fails is a fact about the
 * journal ("there are no trips"), and the turn should end in a sentence about
 * it rather than in a 502.
 */
export async function runTool(
  username: string,
  name: string,
  args: unknown,
): Promise<{ ok: boolean; result: unknown }> {
  const tool = READ_TOOLS.find((one) => one.name === name);
  if (!tool) return { ok: false, result: { error: `there is no tool called ${name}` } };
  const given = (args ?? {}) as Record<string, unknown>;
  const strings: Record<string, string> = {};
  for (const key of Object.keys(tool.properties)) {
    const value = given[key];
    if (typeof value === "string" && value.trim() !== "") strings[key] = value.trim();
  }
  try {
    return { ok: true, result: await tool.run(username, strings) };
  } catch (thrown) {
    return { ok: false, result: { error: (thrown as Error).message } };
  }
}

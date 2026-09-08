import "server-only";
import { balanceOf } from "../credits";
import { getCostSummary } from "../costs";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { formatBytes, storageFor } from "../storageQuota";
import { getTrip, getTrips, tripRef } from "../trips";
import type { Block, Proposal, ProposalField, Shape } from "./blocks";
import type { Say } from "./intents";
import { draftsForWizard } from "./server";

/**
 * The tool contract — B898, round 1 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * **One registry, and the model's list is generated from it.** The prose menu
 * the prompt carries (`toolList()`) and the JSON schemas the SDK is handed
 * (`toolSchemas()`) are both built from `TOOLS`, exactly as `intentList()` is
 * built from `REGISTRY` and for the same reason: a hand-typed list promises a
 * capability nobody built and forgets one that exists. Adding a tool is a row
 * here and nothing else — no client change, because the client draws shapes
 * rather than tools.
 *
 * **Three kinds, three behaviours, and the difference is the whole design.**
 * They are separate members of a union rather than a `kind` field on one
 * shape, so the difference is enforced by the compiler and not by a comment:
 *
 * - **read** — has a `run`, executes immediately, returns its rendered block.
 *   There is nothing to confirm about a question.
 * - **write** — has **no `run` at all.** It has `propose`, which is handed the
 *   arguments and a translator and returns a sentence and some fields. It is
 *   given no username, no writer and no client, so it cannot reach disk; a
 *   write tool that wanted to would have to grow a member this type does not
 *   have. Accepting a proposal is B900.
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
          args: Record<string, string>,
          say: Say,
        ) => { sentence: string; fields: ProposalField[] };
      }
    | {
        kind: "link";
        renders: "link";
        link: (
          username: string,
          say: Say,
        ) => { text: string; href: string; label: string };
      }
  );

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

/** How much of a day's own words travel back to the screen in a preview. */
const PREVIEW_CHARACTERS = 600;

export const TOOLS: readonly Tool[] = [
  {
    name: "list_trips",
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
    name: "trip_costs",
    kind: "read",
    renders: "say",
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
    kind: "read",
    renders: "say",
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
    kind: "read",
    renders: "say",
    describe:
      "How many credits this journal has left. Credits pay for the things that cost money — writing a day up with the model, captions, transcription, printing. Null means this server charges for nothing.",
    properties: {},
    run: async (username) => ({ balance: await balanceOf(username) }),
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
  {
    /**
     * The first write tool, and it writes nothing.
     *
     * There is a `new_trip` row in `./intents.ts` as well; that one is the
     * router's, reached when a sentence matches a registry row, and it also
     * only ever hands fields back to be pressed on. This is the same promise
     * from inside the conversation, and the reason both can exist without
     * disagreeing is that neither of them writes.
     */
    name: "new_trip",
    kind: "write",
    renders: "form",
    describe:
      "Propose a new trip — a journey with a title and a first and last day. This does not create anything: it fills in the fields and the person presses.",
    properties: {
      title: { type: "string", description: "What the trip is called, in the writer's own words." },
      start: { type: "string", description: "The first day, as YYYY-MM-DD." },
      end: { type: "string", description: "The last day, as YYYY-MM-DD." },
    },
    propose: (args, say) => ({
      sentence: say("agent.tool.newTrip", {
        title: args.title ?? "",
        start: args.start ?? "",
        end: args.end ?? "",
      }),
      fields: [
        { name: "title", value: args.title ?? "" },
        { name: "start", value: args.start ?? "", date: true },
        { name: "end", value: args.end ?? "", date: true },
      ],
    }),
  },
  {
    /**
     * The day helper is a screen with its own steps, its own upload and its
     * own publish button, and it stays one. A `link` is how the conversation
     * hands somebody to a page rather than pretending to be it.
     */
    name: "day_helper",
    kind: "link",
    renders: "link",
    describe:
      "Where a day is written up — photographs, the words, the preview and the publish button. Use this when they want to write, correct or publish a day. It only hands them the page; it changes nothing.",
    properties: {},
    link: (username, say) => ({
      text: say("agent.tool.dayHelper"),
      href: `/agent/${encodeURIComponent(username)}`,
      label: say("agent.tool.dayHelperLabel"),
    }),
  },
];

/** The list the model is shown, generated — as `intentList()` is, and for the
 *  same reason: a hand-written menu goes stale the first afternoon. A write
 *  tool says so in its own `describe`, so the menu is honest about which of
 *  these end in a press. */
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
 *  sees. `block` is null for a `say` read — the sentence is the model's. */
export type Ran = {
  ok: boolean;
  result: unknown;
  block: Block | null;
  proposal?: Proposal;
};

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
 * English prose — the same call `./intents.ts` makes.
 */
export async function runTool(
  username: string,
  name: string,
  args: unknown,
  say: Say,
): Promise<Ran> {
  const tool = TOOLS.find((one) => one.name === name);
  if (!tool) {
    return { ok: false, result: { error: `there is no tool called ${name}` }, block: null };
  }
  const given = (args ?? {}) as Record<string, unknown>;
  const strings: Record<string, string> = {};
  for (const key of Object.keys(tool.properties)) {
    const value = given[key];
    if (typeof value === "string" && value.trim() !== "") strings[key] = value.trim();
  }

  if (tool.kind === "write") {
    // Nothing is executed. `propose` is handed the arguments and a translator
    // and returns a value; there is no `run` on a write tool to call.
    const { sentence, fields } = tool.propose(strings, say);
    const proposal: Proposal = { tool: tool.name, arguments: strings, sentence, fields };
    return {
      ok: true,
      // What the model reads back, so its own sentence can say a proposal is
      // waiting rather than claim the trip exists.
      result: { proposed: true, wrote: false, tool: tool.name, arguments: strings },
      block:
        tool.renders === "form"
          ? { shape: "form", text: sentence, fields }
          : { shape: "confirm", text: sentence },
      proposal,
    };
  }

  if (tool.kind === "link") {
    const { text, href, label } = tool.link(username, say);
    return {
      ok: true,
      result: { link: href, wrote: false },
      block: { shape: "link", text, href, label },
    };
  }

  try {
    const result = await tool.run(username, strings);
    return { ok: true, result, block: tool.block?.(result, say) ?? null };
  } catch (thrown) {
    return { ok: false, result: { error: (thrown as Error).message }, block: null };
  }
}

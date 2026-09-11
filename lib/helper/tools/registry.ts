import "server-only";
import type { Tool } from "./types";
import { DAYS_TOOLS } from "./areas/days";
import { FILES_TOOLS } from "./areas/files";
import { JOURNAL_TOOLS } from "./areas/journal";
import { MONEY_TOOLS } from "./areas/money";
import { PRINTED_TOOLS } from "./areas/printed";
import { READERS_TOOLS } from "./areas/readers";
import { TRIPS_TOOLS } from "./areas/trips";

/**
 * The areas a model is offered, and the tools behind each — B1053.
 *
 * **The order is the order the model reads them in**, and it is not
 * alphabetical: trips first because everything hangs off one, days next
 * because that is what this product is for, then the things you do to a day
 * once it exists. A model choosing among forty-odd tools reads the list as a
 * ranking whatever anybody intended, so the ranking is deliberate — and it is
 * the same ranking `answerInThread`'s area pick offers, for the same reason.
 *
 * `describe` is what the area-picking round reads; it is prose about the
 * area, not a tool's own `describe`, and stays in English because it is never
 * shown to a person — only to the model choosing between areas.
 *
 * Adding an area is a file and a row here. Adding a tool is a file — which is
 * the whole reason for the split: the array was nine hundred lines in the same
 * file as the contract, the resolvers and the runtime, and two people could
 * not touch it at once.
 */
export const AREAS = [
  {
    key: "trips",
    describe: "a trip itself: creating one, its dates and visibility, who is on it, its route, reminders",
    tools: TRIPS_TOOLS,
  },
  {
    key: "days",
    describe: "a day: reading, drafting, writing, publishing or unpublishing an entry, looking up its weather",
    tools: DAYS_TOOLS,
  },
  {
    key: "money",
    describe: "money: costs on a day, exchange rates, the trip's budget",
    tools: MONEY_TOOLS,
  },
  {
    key: "files",
    describe: "files: the inbox, attaching a photo to a day, removing or discarding one",
    tools: FILES_TOOLS,
  },
  {
    key: "readers",
    describe: "readers: guest invites, who can read a trip, telling readers about a day, notification channels",
    tools: READERS_TOOLS,
  },
  {
    key: "journal",
    describe: "the journal itself: the account, its settings, storage, keys, credits, past conversations",
    tools: JOURNAL_TOOLS,
  },
  {
    key: "printed",
    describe: "printed things: postcards, the photobook, a contact to send one to, a print order",
    tools: PRINTED_TOOLS,
  },
] as const satisfies readonly { key: string; describe: string; tools: readonly Tool[] }[];

/** One of the seven names above — what the area-picking round returns, and
 *  what `switch_area` takes as its one argument. */
export type AreaKey = (typeof AREAS)[number]["key"];

/** Every tool the model may call, flattened back out — most of the registry's
 *  own callers (the honesty tests, `runTool`'s lookup by name, the generated
 *  menu in the system prompt) want the whole thing and do not care which area
 *  a tool sits in. */
export const TOOLS: readonly Tool[] = AREAS.flatMap((area) => area.tools);

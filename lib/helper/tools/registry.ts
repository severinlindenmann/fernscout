import "server-only";
import type { Tool } from "./types";
import { DAYS_TOOLS } from "./areas/days";
import { FILES_TOOLS } from "./areas/files";
import { JOURNAL_TOOLS } from "./areas/journal";
import { MONEY_TOOLS } from "./areas/money";
import { READERS_TOOLS } from "./areas/readers";
import { TRIPS_TOOLS } from "./areas/trips";

/**
 * Every tool the model may call — B898, split into areas by B1042.
 *
 * **The order is the order the model reads them in**, and it is not
 * alphabetical: trips first because everything hangs off one, days next
 * because that is what this product is for, then the things you do to a day
 * once it exists. A model choosing among forty-odd tools reads the list as a
 * ranking whatever anybody intended, so the ranking is deliberate.
 *
 * Adding an area is a file and a line here. Adding a tool is a file — which is
 * the whole reason for the split: the array was nine hundred lines in the same
 * file as the contract, the resolvers and the runtime, and two people could
 * not touch it at once.
 */
export const TOOLS: readonly Tool[] = [
  ...TRIPS_TOOLS,
  ...DAYS_TOOLS,
  ...MONEY_TOOLS,
  ...FILES_TOOLS,
  ...READERS_TOOLS,
  ...JOURNAL_TOOLS,
];

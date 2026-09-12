// A trip, as v2 speaks it: the whole trip is one JSON document — B1587.
//
// Read whole, written whole (or merge-patched). What today is ~12 routes
// (/rates, /people, /visibility, /costs, /plan …) is sections of this one
// schema, each always-required, required-or-declined, or server-owned.
import { z } from "zod";
import {
  ACCENTS,
  COSTS_VISIBILITIES,
  STATUSES,
  VISIBILITIES,
} from "../../../tripWrite";
import { MAX_TRIP_PEOPLE } from "../../../trips";
import { dayDoc, dayWrite } from "./day";
import {
  checkRequiredOrDeclined,
  declinedMap,
  isoDate,
  tripId,
  type Declinable,
} from "./shared";

/** ── sections ────────────────────────────────────────────────────────── */

/** Who took the trip: write access, byline, and who may hold a trip-scoped
 * token. At least one — a trip nobody was on is not a trip — so there is no
 * decline path. */
const person = z.strictObject({
  name: z.string().trim().min(1),
  email: z.email(),
});

/** The currencies money moved in on this trip, against the journal's base.
 * The reference table for conversion stays the server's (ECB); this is only
 * which currencies the trip's figures may name. */
const rates = z.strictObject({
  currencies: z.array(z.string().length(3)).min(1),
});

/** Budget + preparation costs — what costs.md carries today. Entries on days
 * live on the days. */
const costs = z.strictObject({
  budget: z.strictObject({
    total: z.number().positive(),
    /** Absent means the trip's own day count. */
    days: z.number().int().positive().optional(),
    /** Absent means the journal's base currency. */
    currency: z.string().length(3).optional(),
  }),
  /** Whether readers of the trip see the money: public (anyone who can read
   * the trip) or guests (narrower). Absent reads as public. */
  visibility: z.enum(COSTS_VISIBILITIES).optional(),
});

/** The intended route, for an upcoming trip — plan.md today. */
const planStop = z.strictObject({
  location: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  country: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  note: z.string().optional(),
});
const plan = z.strictObject({
  route: z.array(planStop).min(1),
  body: z.string().optional(),
});

/** ── the required-or-declined ledger for a trip ──────────────────────── */

export const TRIP_DECLINABLES: readonly Declinable[] = [
  {
    field: "rates",
    whyRequired: "every trip states the currencies its figures may use, or declines them",
  },
  {
    field: "costs",
    whyRequired: "every trip carries a budget, or says why costs are not tracked here",
  },
  {
    field: "plan",
    whyRequired: "an upcoming trip carries its intended route, or says why there is none",
  },
  {
    field: "days",
    whyRequired: "a trip carries its days, or says why there are none yet (e.g. it has not started)",
  },
] as const;

/**
 * Creating a trip: the whole document at once. Every declinable section is
 * present or in `declined` — a silent omission answers 422 with the missing
 * list, which is the documentation delivered at the moment it is needed.
 */
export const tripCreate = z
  .strictObject({
    // ── always required ──
    /** Client-chosen, forever. Retried create → 409 with the stored doc. */
    id: tripId,
    title: z.string().trim().min(1).max(200),
    dates: z.strictObject({ from: isoDate, to: isoDate }),
    /** An explicit choice, never a guessed default — a typo must not publish
     * somebody's trip. Unrecognised reads as private on disk; here it is
     * refused outright. */
    visibility: z.enum(VISIBILITIES),
    people: z.array(person).min(1).max(MAX_TRIP_PEOPLE),

    // ── required-or-declined ──
    rates: rates.optional(),
    costs: costs.optional(),
    plan: plan.optional(),
    days: z.array(dayWrite).optional(),
    declined: declinedMap(["rates", "costs", "plan", "days"]).optional(),

    // ── plain optional ──
    tagline: z.string().optional(),
    intro: z.string().optional(),
    accent: z.enum(ACCENTS).optional(),
    /** Absent means derived from the dates (calendarStatus). */
    status: z.enum(STATUSES).optional(),
    /** Only ever narrows: false keeps a public trip out of sitemap/feed;
     * true on a closed trip is refused. */
    listed: z.boolean().optional(),
    /** A closed trip advertising its existence: locked card, title + dates,
     * nothing else. Refused on a public trip. */
    teaser: z.boolean().optional(),
    /** Content nobody lived. */
    test: z.boolean().optional(),
  })
  .superRefine((doc, ctx) => checkRequiredOrDeclined(doc, TRIP_DECLINABLES, ctx));

/**
 * What every GET answers: the stored document plus the server-owned truth.
 * `days` echoes as full day documents; on *update* the `days` key is
 * rejected (read-only echo) — a day changes through its own slug route, so
 * deleting one can never be a side effect of shortening a list.
 */
export const tripDoc = z.object({
  ...tripCreate.def.shape,
  days: z.array(dayDoc),
  // ── server-owned ──
  /** The ground actually covered, derived from the gps store, clipped and
   * cleaned. Never writable; the store itself is reachable by no route. */
  track: z.strictObject({ present: z.boolean(), updatedAt: z.string().optional() }).optional(),
  /** Merged write-access list: the people block plus approved buddy rows.
   * The byline stays the file's own people. */
  peopleResolved: z.array(z.strictObject({ name: z.string(), viaBuddyLink: z.boolean() })).optional(),
  cover: z.string().optional(),
});

export type TripCreate = z.infer<typeof tripCreate>;

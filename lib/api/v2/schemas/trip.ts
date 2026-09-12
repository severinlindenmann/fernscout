// A trip, as v2 speaks it: the whole trip is one JSON document — B1587.
//
// Read whole, written whole (or merge-patched). What today is ~12 routes
// (/rates, /people, /visibility, /costs, /plan …) is sections of this one
// schema, each always-required, required-or-declined, or server-owned.
import { z } from "zod";
import { ACCENTS, COSTS_VISIBILITIES, STATUSES, VISIBILITIES } from "../../../tripWrite";
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

/** The trip's card text in the journal's other languages. The route refuses
 * a locale the journal does not declare, since it would be written and never
 * rendered — that check needs the journal's config and lives at the door. */
const translations = z.record(
  z.string(),
  z.strictObject({ title: z.string().optional(), tagline: z.string().optional() }),
);

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
  {
    field: "translations",
    whyRequired:
      "a journal that maintains several languages carries each trip's title and tagline in all of them, or says why not (a single-language journal is exempt — the route skips this check)",
  },
  {
    field: "accent",
    whyRequired: "every trip picks the colour its cards are drawn in, or leaves it to the default with a reason",
  },
  {
    field: "cover",
    whyRequired:
      "a trip names the photograph its card shows (a media src), or declines — a declined cover is auto-picked from the newest photograph, and the echo says which",
  },
  {
    field: "tagline",
    whyRequired: "every trip card carries its one-line subtitle, or a reason it has none",
  },
  {
    field: "intro",
    whyRequired: "a trip page opens with a few lines of prose, or says why there are none",
  },
] as const;

/** Asked only of a public trip — a closed trip is never advertised, so the
 * question does not exist there and both the field and its decline are
 * refused. */
const LISTED_DECLINABLE: Declinable = {
  field: "listed",
  whyRequired:
    "a public trip states whether it is advertised (sitemap, feed, switcher): listed true or false, or declined",
};

const DECLINABLE_KEYS = ["rates", "costs", "plan", "days", "translations", "accent", "cover", "tagline", "intro", "listed", "buddies"] as const;

/**
 * Creating a trip: the whole document at once. Every declinable section is
 * present or in `declined` — a silent omission answers 422 with the missing
 * list, which is the documentation delivered at the moment it is needed.
 *
 * Deliberately absent from the write shape:
 * - `status` — derived from the dates on every read (calendarStatus), never
 *   written. v1's manual override is retired; a stored status is how a trip
 *   stays "current" for a year (decided 2026-09-12).
 * - v1's `tracks:` — "what this trip keeps track of" is now the same
 *   declined map as everything else, one mechanism instead of two.
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
    /** Who is on the trip — the owner plus any buddies, each name + email.
     * Everyone listed may write to the trip; the access only materialises
     * when that person proves the address through the sign-in code, so a
     * wrong email grants nothing. The server mails every newly added
     * non-owner: a "you are on trip X" note if the address is already known
     * to this journal, an onboarding invite if it is not — and the echo's
     * `notifications` says which went out. A trip with only the owner on it
     * declines `buddies` instead ("travelling solo"). */
    people: z.array(person).min(1).max(MAX_TRIP_PEOPLE),
    /** Required on a closed trip (guest/private): may the trip's existence
     * show as a locked card? A boolean is its own answer, so there is no
     * decline path — bring true or false. Refused on a public trip, where
     * `listed` is the key that decides. B587. */
    teaser: z.boolean().optional(),

    // ── required-or-declined (see TRIP_DECLINABLES) ──
    rates: rates.optional(),
    costs: costs.optional(),
    plan: plan.optional(),
    days: z.array(dayWrite).optional(),
    translations: translations.optional(),
    accent: z.enum(ACCENTS).optional(),
    /** The media src the trip's card shows. Upload through the media door
     * first; set or change it here any time. */
    cover: z.string().optional(),
    /** One line under the title on the trip card. */
    tagline: z.string().optional(),
    /** The trip page's opening prose — trip.md's body. */
    intro: z.string().optional(),
    /** Public trips only: is the trip advertised (sitemap, feed, switcher)?
     * false is "unlisted" — still readable at its URL. On a closed trip the
     * question does not exist and the key is refused. B51. */
    listed: z.boolean().optional(),
    declined: declinedMap(DECLINABLE_KEYS).optional(),

    // ── plain optional ──
    /** Content nobody lived. */
    test: z.boolean().optional(),
  })
  .superRefine((doc, ctx) => {
    const declinables =
      doc.visibility === "public" ? [...TRIP_DECLINABLES, LISTED_DECLINABLE] : TRIP_DECLINABLES;
    checkRequiredOrDeclined(doc, declinables, ctx);
    // buddies: a solo trip says so; a trip with buddies has answered.
    if (doc.people !== undefined) {
      const solo = doc.people.length <= 1;
      const buddiesDeclined = doc.declined?.buddies !== undefined;
      if (solo && !buddiesDeclined) {
        ctx.addIssue({
          code: "custom",
          path: ["people"],
          message:
            "only one person is on this trip — add the buddies who were there (name + email; the server mails them), or decline: declined.buddies (e.g. travelling solo)",
          params: { v2: "missing", toDecline: "declined.buddies: <reason>" },
        });
      }
      if (!solo && buddiesDeclined) {
        ctx.addIssue({
          code: "custom",
          path: ["people"],
          message: "buddies are both listed in people and declined — remove one",
          params: { v2: "conflict" },
        });
      }
    }
    // listed: a public trip's question only.
    if (doc.visibility !== "public" && (doc.listed !== undefined || doc.declined?.listed !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["listed"],
        message:
          "a closed trip is never advertised, so there is nothing to list or to decline — remove listed",
        params: { v2: "conflict" },
      });
    }
    // teaser: mandatory question on a closed trip, meaningless on an open one.
    if (doc.visibility === "public" && doc.teaser !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["teaser"],
        message: "a public trip has nothing to tease — `listed` is the key that decides. Remove teaser.",
        params: { v2: "conflict" },
      });
    }
    if (doc.visibility !== "public" && doc.teaser === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["teaser"],
        message:
          "a closed trip states whether its existence may show as a locked card: teaser: true or teaser: false",
        params: { v2: "missing" },
      });
    }
  });

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
  /** Derived from the dates on every read; stored nowhere. */
  status: z.enum(STATUSES),
  /** One field on read too: the cover actually in effect. When the write
   * declined it, this is the auto-picked newest photograph — the
   * `declined.cover` entry standing beside it is how an agent tells a
   * choice from an auto-pick. Absent only while the trip has no photos. */
  cover: z.string().optional(),
  /** The ground actually covered, derived from the gps store, clipped and
   * cleaned. Never writable; the store itself is reachable by no route. */
  track: z.strictObject({ present: z.boolean(), updatedAt: z.string().optional() }).optional(),
  /** What the server mailed when people were added: a "you are on trip X"
   * note to an address this journal already knows, an onboarding invite to
   * one it does not. Report these as mails sent — never as access granted;
   * access materialises when the person proves the address. */
  notifications: z
    .array(z.strictObject({ email: z.string(), kind: z.enum(["trip-added", "journal-invite"]) }))
    .optional(),
});

export type TripCreate = z.infer<typeof tripCreate>;

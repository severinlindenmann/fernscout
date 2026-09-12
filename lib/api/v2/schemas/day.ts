// A day, as v2 speaks it — B1587, phase 0.
//
// Storage stays markdown; this is the wire shape only. Field vocabulary is
// v1's (lib/validate/entry.ts) — v2 changes how omission is handled, not what
// a day is.
import { z } from "zod";
import { TRANSPORT_MODES, TRAVEL_SCENE_VARIANTS } from "../../../validate/entry";
import { COST_CATEGORIES } from "../../../costFormat";
import { RESERVED_SOURCES } from "../../../weather";
import {
  checkRequiredOrDeclined,
  declinedMap,
  isoDate,
  isoInstant,
  type Declinable,
} from "./shared";

/** ── building blocks ─────────────────────────────────────────────────── */

const costItem = z.strictObject({
  label: z.string().trim().min(1),
  amount: z.number().positive(),
  category: z.enum(COST_CATEGORIES).optional(),
  /** Absent means the trip's base currency. */
  currency: z.string().length(3).optional(),
});

/**
 * A reading somebody actually took — never composed. `source` is required
 * because a number with no source is indistinguishable from one made up, and
 * `open-meteo` is refused because that name means *this server* looked it up.
 */
const weatherData = z
  .strictObject({
    tempMin: z.number().min(-90).max(60).optional(),
    tempMax: z.number().min(-90).max(60).optional(),
    code: z.number().int().min(0).max(99).optional(),
    precipitation: z.number().min(0).max(2000).optional(),
    windMax: z.number().min(0).max(500).optional(),
    source: z
      .string()
      .trim()
      .min(1)
      .refine((s) => !(RESERVED_SOURCES as readonly string[]).includes(s.toLowerCase()), {
        message: "this source name is the server's own — a caller may never claim it",
      }),
    recordedAt: isoInstant,
  })
  .refine(
    (w) =>
      w.tempMin !== undefined ||
      w.tempMax !== undefined ||
      w.code !== undefined ||
      w.precipitation !== undefined ||
      w.windMax !== undefined,
    { message: "at least one measurement" },
  );

/** src → caption / src → guest|private. Media items are addressed by the
 * `src` the media door answered with. */
const captions = z.record(z.string(), z.string());
const photoVisibility = z.record(z.string(), z.enum(["guest", "private"]));

/** ── what an agent may decline on a day, and why it is asked at all ──── */

export const DAY_DECLINABLES: readonly Declinable[] = [
  {
    field: "media",
    whyRequired:
      "a day names the photographs on it (by the src the media door answered with), or says why there are none",
  },
  {
    field: "costs",
    whyRequired:
      "a day carries what was spent on it, or says why not (nothing spent / figures lost / owner tracks costs elsewhere)",
  },
  {
    field: "coordinates",
    whyRequired: "a day carries where it happened (lat/lng), or says why there is no position",
  },
  {
    field: "weather",
    whyRequired:
      "a day asks the server to look its weather up (weather: true), brings a real reading (weatherData), or declines",
  },
] as const;

/**
 * What an agent sends. Always arrives as a draft — `status` is server-owned
 * and publish is a separate call (B28), so there is a moment for a person to
 * read the day back before it is on the site.
 */
export const dayWrite = z
  .strictObject({
    /** Client-chosen, forever: YYYY-MM-DD-slug. Retried create → 409. */
    slug: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/),

    // ── always required ──
    title: z.string().trim().min(1).max(200),
    date: isoDate,
    /** The prose body — what was actually told. No weather nobody mentioned,
     * no meals nobody ate. */
    content: z.string().max(100_000),

    // ── required-or-declined (see DAY_DECLINABLES) ──
    media: z.array(z.strictObject({ src: z.string(), caption: z.string().optional() })).optional(),
    costs: z.array(costItem).optional(),
    coordinates: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    weather: z.union([z.literal(true), weatherData]).optional(),
    declined: declinedMap(["media", "costs", "coordinates", "weather"]).optional(),

    // ── plain optional: detail that has no "why not" question ──
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    /** IANA zone `time` is local to. Sent when the file or the person
     * supplies it — never guessed on somebody's behalf. */
    timezone: z.string().optional(),
    location: z.string().optional(),
    country: z.string().optional(),
    countryCode: z.string().length(2).optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    transportFrom: z.string().optional(),
    transportTo: z.string().optional(),
    travelScene: z.enum(TRAVEL_SCENE_VARIANTS).optional(),
    tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(30)).max(10).optional(),
    /** title+content in the journal's other languages, keyed by locale. */
    translations: z.record(z.string(), z.strictObject({ title: z.string(), content: z.string() })).optional(),
    captions: captions.optional(),
    /** A photograph held back, keyed by src — narrows only (B596). */
    photoVisibility: photoVisibility.optional(),
    /** Narrows only: guest|private on top of the trip's own gate; null lifts
     * a hold. There is deliberately no "public". */
    visibility: z.enum(["guest", "private"]).nullable().optional(),
    /** Content nobody lived, written to prove the pipeline works. */
    test: z.boolean().optional(),
  })
  .superRefine((doc, ctx) => checkRequiredOrDeclined(doc, DAY_DECLINABLES, ctx));

/**
 * What every GET (and every write's echo) answers: the write shape plus the
 * server-owned truth. "It was accepted" and "it is there" are the same claim.
 */
export const dayDoc = z.object({
  ...dayWrite.def.shape,
  // ── server-owned: present in every read, rejected in every write ──
  status: z.enum(["draft", "published"]),
  /** Server-fetched weather (source: open-meteo) when the day asked for it. */
  weatherResolved: weatherData.optional(),
  /** Derivative URLs per media item, from the media door. */
  mediaResolved: z.array(z.object({ src: z.string(), url: z.string(), caption: z.string().optional() })).optional(),
});

export type DayWrite = z.infer<typeof dayWrite>;

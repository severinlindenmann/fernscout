// A day, as v2 speaks it — B1587, phase 0.
//
// Storage stays markdown; this is the wire shape only. Field vocabulary is
// v1's (lib/validate/entry.ts) — v2 changes how omission is handled, not what
// a day is. v1's per-field decline encodings (`costs: false`, `"unknown"`,
// `coordinates: false`, `photos: false` — B531/B560) are retired: the
// `declined` map is the one mechanism, everywhere.
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

/** A photograph on the day, addressed by the src the media door answered
 * with. Caption and hold-back live here, per item — v1's separate `captions`
 * and `photoVisibility` maps are retired (owner review, 2026-09-12).
 * `visibility` narrows only, on top of the trip's own gate (B596). */
const dayMediaItem = z.strictObject({
  src: z.string(),
  caption: z.string().optional(),
  visibility: z.enum(["guest", "private"]).optional(),
});

/** ── what a day is asked, and why ────────────────────────────────────── */

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
      "a day asks the server to look its weather up (weather: true), brings a real reading, or declines",
  },
  {
    field: "time",
    whyRequired: "a day says when it happened (HH:MM, local), or declines",
  },
  {
    field: "timezone",
    whyRequired: "the IANA zone the time is local to, or a reason it is not known",
  },
  {
    field: "location",
    whyRequired: "the place this day happened, or why none is named",
  },
  {
    field: "country",
    whyRequired: "the country this day happened in, or why none is named",
  },
  {
    field: "countryCode",
    whyRequired: "the ISO-2 code behind the flag the day card draws, or a decline",
  },
  {
    field: "transportMode",
    whyRequired: "how this day travelled, or a decline for a day with no leg (a rest day)",
  },
  {
    field: "tags",
    whyRequired: "the day's tags, or a decline",
  },
  {
    field: "translations",
    whyRequired:
      "a journal that maintains several languages carries the day in all of them, or declines — a declined translation falls back to the main language (a single-language journal is exempt; the route skips this check)",
  },
  {
    field: "visibility",
    whyRequired:
      "whether this day is held back (guest or private, narrowing the trip's own gate), or declined — declined means shown to everyone the trip lets in",
  },
  {
    field: "status",
    whyRequired:
      'a day states it arrives as a draft — status: "draft" is the only writable value; publishing stays its own call',
  },
] as const;

const DAY_DECLINABLE_KEYS = [
  "media", "costs", "coordinates", "weather", "time", "timezone", "location",
  "country", "countryCode", "transportMode", "tags", "translations",
  "visibility", "status",
] as const;

/**
 * What an agent sends. Always arrives as a draft — `status` accepts the
 * literal "draft" and nothing else, so publish stays a separate call (B28)
 * and there is a moment for a person to read the day back first.
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
    media: z.array(dayMediaItem).optional(),
    costs: z.array(costItem).optional(),
    coordinates: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    weather: z.union([z.literal(true), weatherData]).optional(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    /** IANA zone `time` is local to. Never guessed on somebody's behalf. */
    timezone: z.string().optional(),
    location: z.string().optional(),
    country: z.string().optional(),
    countryCode: z.string().length(2).optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(30)).max(10).optional(),
    /** title+content in the journal's other languages, keyed by locale.
     * Declined falls back to the main language. */
    translations: z.record(z.string(), z.strictObject({ title: z.string(), content: z.string() })).optional(),
    /** Narrows only: guest|private on top of the trip's own gate. There is
     * deliberately no "public". */
    visibility: z.enum(["guest", "private"]).optional(),
    /** The one writable value. "published" is refused here, always. */
    status: z.literal("draft").optional(),
    declined: declinedMap(DAY_DECLINABLE_KEYS).optional(),

    // ── plain optional: detail that rides another answer ──
    transportFrom: z.string().optional(),
    transportTo: z.string().optional(),
    travelScene: z.enum(TRAVEL_SCENE_VARIANTS).optional(),
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
  /** The server's own lookup (source: open-meteo) when the day asked for it. */
  weatherResolved: weatherData.optional(),
  /** Derivative URLs per media item, from the media door. */
  mediaResolved: z.array(z.object({ src: z.string(), url: z.string(), caption: z.string().optional() })).optional(),
});

export type DayWrite = z.infer<typeof dayWrite>;

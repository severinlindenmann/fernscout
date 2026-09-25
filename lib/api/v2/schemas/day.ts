// A day, as v2 speaks it — B1587, phase 0.
//
// Storage moved to JSON alongside the wire shape (B1606); this schema is
// still the wire contract, not the on-disk format, in case the two diverge
// again. Field vocabulary is
// v1's (lib/validate/entry.ts) — v2 changes how omission is handled, not what
// a day is. v1's per-field decline encodings (`costs: false`, `"unknown"`,
// `coordinates: false`, `photos: false` — B531/B560) are retired: the
// `declined` map is the one mechanism, everywhere.
import { z } from "zod";
import { PHOTO_VISIBILITIES } from "../../../photos";
import { TRANSPORT_MODES, TRAVEL_SCENE_VARIANTS } from "../../../validate/entry";
import { COST_CATEGORIES } from "../../../costFormat";
import { RESERVED_SOURCES } from "../../../weather";
import {
  checkPatchConflicts,
  checkRequiredOrDeclined,
  declinedMap,
  isoDate,
  isoInstant,
  type Declinable,
} from "./shared";

/** A day's own slug pattern — `YYYY-MM-DD-slug`, client-chosen, forever.
 * Exported (D6, 06-contract-deltas.md) so the day route can validate a URL's
 * slug segment against the exact same pattern the write schema does, rather
 * than a second regex that could drift from it — a slug is also a filename,
 * so this is a security boundary as much as a shape check. */
export const daySlug = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;

/** ── building blocks ─────────────────────────────────────────────────── */

/** Exported for `trip.ts`'s `costs.items` (B1597) — preparation spend, before
 * there are any days to carry it, is the same shape as a day's own cost
 * line. One shape, imported, rather than a second copy that drifts. */
export const costItem = z.strictObject({
  label: z.string().trim().min(1),
  amount: z.number().positive(),
  category: z.enum(COST_CATEGORIES).optional(),
  /** Absent means the trip's base currency. */
  currency: z.string().length(3).optional(),
  /** Which planned stop this spend belongs to — a `plan.route[].id`
   * (B2009). Not checked against the route here: a cost item can be
   * written on a day, long before or after the trip's own plan is, and a
   * schema for one has no way to see the other's document. */
  stop: z.string().optional(),
});

/** The most cost lines one day (or a trip's preparation list) takes on a
 * write, and the longest label — B2243. A day with 200 receipts is already
 * more than any real day; a label is a merchant or a meal, and 200
 * characters is a bank descriptor with room to spare. Published at
 * `GET /api/v2/status` (`limits.costLinesMax`, `limits.costLabelMaxChars`). */
export const COST_LINES_MAX = 200;
export const COST_LABEL_MAX_CHARS = 200;

/** `costItem` as a caller may WRITE it — the label bounded. Only the
 * incoming request shapes (`dayWrite`, `dayPatch`, the trip's create and
 * patch) use it. Everything that validates what is already STORED — the
 * merged re-checks, the publish check, every read — keeps the unbounded
 * `costItem`, so a day that is over the bounds for any reason can still be
 * corrected, published and read (B2243 review F1). */
const costLine = costItem.extend({ label: z.string().trim().min(1).max(COST_LABEL_MAX_CHARS) });
export const costLines = z.array(costLine).max(COST_LINES_MAX);

/**
 * The measurements themselves, shared by both directions — one list of
 * fields and ranges, so a reading cannot mean two different things
 * depending on which way it is travelling.
 */
const weatherMeasurements = {
  tempMin: z.number().min(-90).max(60).optional(),
  tempMax: z.number().min(-90).max(60).optional(),
  code: z.number().int().min(0).max(99).optional(),
  precipitation: z.number().min(0).max(2000).optional(),
  windMax: z.number().min(0).max(500).optional(),
  recordedAt: isoInstant,
};

/** At least one measurement — a reading of nothing is not a reading. */
const hasAMeasurement = (w: { tempMin?: number; tempMax?: number; code?: number; precipitation?: number; windMax?: number }) =>
  w.tempMin !== undefined ||
  w.tempMax !== undefined ||
  w.code !== undefined ||
  w.precipitation !== undefined ||
  w.windMax !== undefined;

/**
 * A reading a CALLER sent — never composed, and never claiming to be the
 * server's own: `source` is required because a number with no source is
 * indistinguishable from one made up, and `open-meteo` is refused because
 * that name means *this server* looked it up (B1578).
 */
const weatherData = z
  .strictObject({
    ...weatherMeasurements,
    source: z
      .string()
      .trim()
      .min(1)
      .refine((s) => !(RESERVED_SOURCES as readonly string[]).includes(s.toLowerCase()), {
        message: "this source name is the server's own — a caller may never claim it",
      }),
  })
  .refine(hasAMeasurement, { message: "at least one measurement" });

/**
 * The same reading as it is READ BACK — B1645. Identical in every field
 * except that `open-meteo` is allowed here, because the server writes it:
 * a day that asked for a lookup (`weather: true`) carries the archive's own
 * reading afterwards, and a read shape that refused it could not answer for
 * the ordinary case. The asymmetry IS the rule — a caller may not claim the
 * server's name, and the server may — so it lives in two schemas rather
 * than one loosened one.
 */
const weatherReading = z
  .strictObject({
    ...weatherMeasurements,
    source: z.string().trim().min(1),
  })
  .refine(hasAMeasurement, { message: "at least one measurement" });

/** A photograph on the day, addressed by the src the media door answered
 * with. Caption and hold-back live here, per item — v1's separate `captions`
 * and `photoVisibility` maps are retired (owner review, 2026-09-12).
 * `visibility` narrows only, on top of the trip's own gate (B596). */
const dayMediaItem = z.strictObject({
  src: z.string(),
  caption: z.string().optional(),
  visibility: z.enum(PHOTO_VISIBILITIES).optional(),
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

/**
 * Exported (D10, 06-contract-deltas.md) so `publishRequest.declineTracked`
 * can be an enum of the real decline keys rather than free strings. It was
 * `z.array(z.string())`, which accepted `declineTracked: ["nonsense"]` and
 * wrote that straight into the day's `declined` map as a key nothing reads —
 * a decline that looks recorded and answers no question anybody asked.
 */
export const DAY_DECLINABLE_KEYS = [
  "media", "costs", "coordinates", "weather", "time", "timezone", "location",
  "country", "countryCode", "transportMode", "tags", "translations",
  "visibility", "status",
] as const;

/**
 * What an agent sends. Always arrives as a draft — `status` accepts the
 * literal "draft" and nothing else, so publish stays a separate call (B28)
 * and there is a moment for a person to read the day back first.
 */
const dayBase = z
  .strictObject({
    /** Client-chosen, forever: YYYY-MM-DD-slug. Retried create → 409. */
    slug: z.string().regex(daySlug),

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
    /** ISO 3166-1 alpha-2. Derived from `country` on write when it is absent
     * and the name is one the server can place (B1907) — what a book prints
     * its chapter titles from, in the book's own language. */
    countryCode: z.string().length(2).optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(30)).max(10).optional(),
    /** title+content in the journal's other languages, keyed by locale.
     * Declined falls back to the main language. Both fields are required —
     * a translator who leaves the title as-is writes that same string into
     * the locale's own `title` (owner review, 2026-09-12): an absent title
     * and a title deliberately identical to the original are different
     * claims, and only the written-out one survives being read back a year
     * later. */
    translations: z.record(z.string(), z.strictObject({ title: z.string(), content: z.string() })).optional(),
    /** Narrows only: guest|private on top of the trip's own gate. There is
     * deliberately no "public". */
    visibility: z.enum(PHOTO_VISIBILITIES).optional(),
    /** The one writable value. "published" is refused here, always. */
    status: z.literal("draft").optional(),
    declined: declinedMap(DAY_DECLINABLE_KEYS).optional(),

    // ── plain optional: detail that rides another answer ──
    transportFrom: z.string().optional(),
    transportTo: z.string().optional(),
    travelScene: z.enum(TRAVEL_SCENE_VARIANTS).optional(),
    /** Content nobody lived, written to prove the pipeline works. */
    test: z.boolean().optional(),
  });

export const dayWrite = dayBase.extend({ costs: costLines.optional() }).superRefine((doc, ctx) =>
  checkRequiredOrDeclined(doc, DAY_DECLINABLES, ctx),
);

/**
 * The **merged** document a `PATCH` re-validates — B1713.
 *
 * A patch is checked as a patch (`dayPatch`), and then the stored day with the
 * patch laid over it is checked again in full, so a day that was complete
 * stays provably complete. That second check ran `dayWrite`, which refuses
 * `source: "open-meteo"` — and once the server started answering
 * `weather: true` in the write itself, the stored half of that merge is very
 * often exactly such a reading. The result was a `400` on
 * `weather.source: "this source name is the server's own — a caller may never
 * claim it"` for a caller who had sent no weather at all: correcting a typo on
 * a day the server had looked up became impossible.
 *
 * So this is `dayWrite` with the *read* reading allowed, and nothing else
 * changed. The rule it must not weaken — a caller may never claim the
 * server's own source — is enforced where the caller's own bytes are:
 * `dayPatch` for a correction and `dayWrite` for a create, both of which still
 * refuse it. Same asymmetry as `dayDoc`, and the same reasoning as B1645,
 * which found the read shape refusing what the server itself had written.
 */
const dayMergedShape = z.strictObject({
  ...dayBase.def.shape,
  weather: z.union([z.literal(true), weatherReading]).optional(),
});
export const dayMerged = dayMergedShape.superRefine((doc, ctx) => checkRequiredOrDeclined(doc, DAY_DECLINABLES, ctx));

/**
 * What `PATCH` re-validates its merged document with — B2241/B2242.
 *
 * The title may be blank here, because the stored half can be: the studio
 * saves an untitled draft (B1442, blank stays blank) and a correction to
 * something else must not be refused for the title the caller never sent. A
 * caller still cannot blank a title — `dayPatch` refuses `""`.
 *
 * A **draft** is not asked for completeness either: the studio saves drafts
 * with declinables left blank (B2192), and completeness is asked once, at
 * publish (`missingAtPublish`). A draft still refuses a section given and
 * declined at once. A **published** day keeps the full check, so a day
 * readers can see stays provably complete.
 */
const dayPatchedShape = dayMergedShape.extend({ title: z.string().trim().max(200) });
export const dayPatchedDraft = dayPatchedShape.superRefine((doc, ctx) => checkPatchConflicts(doc, DAY_DECLINABLE_KEYS, ctx));
export const dayPatchedPublished = dayPatchedShape.superRefine((doc, ctx) => checkRequiredOrDeclined(doc, DAY_DECLINABLES, ctx));

/**
 * Correcting a day (V2): JSON-merge-patch semantics over the same shape.
 * Nothing is asked — attaching one photograph must not re-open 14 questions
 * — but a patch cannot contradict itself, and supplying a previously
 * declined section clears the decline in the write path (T6). The slug in
 * the URL is the identity; a slug in the body must match it (route check).
 */
export const dayPatch = dayBase
  .extend({ costs: costLines.optional() })
  .partial()
  .superRefine((doc, ctx) => checkPatchConflicts(doc, DAY_DECLINABLE_KEYS, ctx));

/**
 * What every GET (and every write's echo) answers: the write shape plus the
 * server-owned truth. "It was accepted" and "it is there" are the same claim.
 */
export const dayDoc = z.object({
  ...dayBase.def.shape,
  /** Blank on an untitled draft the studio saved (B1442, B2241) — the read
   * shape accepts what the server itself wrote. A write still needs one. */
  title: z.string().max(200),
  // ── server-owned: present in every read, rejected in every write ──
  status: z.enum(["draft", "published"]),
  /** Two fields on read only, expressed the way every server-owned field on
   * this document is — extended onto the write shape rather than added to it,
   * so `dayWrite` goes on refusing both. `url` is the URL of the item's
   * browser-served derivative, the proof the photograph is attached and
   * servable rather than merely accepted (the B540 distinction). `alt` is
   * what the photograph shows, for a reader who cannot see it; written by the
   * journal's helper once (B1866/B1867), never accepted from a caller, and
   * absent for anything nothing has described. */
  media: z.array(dayMediaItem.extend({ url: z.string(), alt: z.string().optional() })).optional(),
  /** One field on read too: still `true` while a requested lookup has no
   * answer yet, otherwise the reading — whose `source` says whose it is.
   * "open-meteo" means the server looked it up; anything else is what the
   * person supplying it called their instrument. A client forwarding a
   * journal skips open-meteo entries rather than sending them back (B1578) —
   * the WRITE shape is what refuses the reserved source; this one must
   * accept it, because it is what the server itself wrote (B1645). */
  weather: z.union([z.literal(true), weatherReading]).optional(),
});

export type DayWrite = z.infer<typeof dayWrite>;

/**
 * `?days=summaries` on `GET .../trips/{trip}` — a day's own row rather than
 * the whole document, completing a projection the contract already promises
 * (V12's `?days=`) rather than widening anything new (see
 * 06-contract-deltas.md).
 */
export const daySummary = z.strictObject({
  slug: z.string(),
  title: z.string(),
  date: isoDate,
  status: z.enum(["draft", "published"]),
  test: z.boolean().optional(),
});
export type DaySummary = z.infer<typeof daySummary>;

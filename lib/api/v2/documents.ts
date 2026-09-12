// The one place that maps a v2 wire document onto the bytes of a file on
// disk, and back — B1596, and reshaped by B1606.
//
// Pure, like lib/validate/*: no fs, no "server-only", no next import. What
// touches the filesystem is a later ticket's job (the day and trip routes);
// this module only knows how to turn an object into a string and a string
// back into the same object.
//
// This file used to be lib/api/v2/markdown.ts, and emitted YAML frontmatter
// over a prose body via gray-matter. The owner overruled that on
// 2026-09-12 (docs/v2-migration/00-decisions.md, decision 4): **content on
// disk becomes JSON.** That argument's whole premise — that costs.md and
// plan.md deserved to stay separate files because each had a real prose
// body a person reads — has nothing left to stand on once there is no
// prose-vs-frontmatter split to keep: costs and plan are sections of one
// document on the wire already, and there is now only one address for a
// trip's facts to live at. So the three trip files became one, and a day
// remains one file per document because each day genuinely is a separate
// document with its own slug and its own route.
//
// If a future reader is tempted to bring frontmatter back for some new
// on-disk shape: don't reinvent the escaping this file used to carry.
// `matter.stringify`'s YAML emission existed only to solve YAML's own
// problems (an unescaped newline in a title closing the frontmatter block
// from inside the value — B204 — and a body starting "---" being
// re-parsed as a second frontmatter block — B1601). `JSON.stringify` has
// neither problem: a string is a string, quoted once, and a body cannot be
// mistaken for a delimiter it never had.
import type { z } from "zod";
import type { dayWrite } from "./schemas/day";
import type { tripCreate } from "./schemas/trip";

/** ── day ─────────────────────────────────────────────────────────────── */

type DayWriteShape = z.infer<typeof dayWrite>;
type DayMediaWire = NonNullable<DayWriteShape["media"]>[number];

/**
 * The v2 day document, plus the two things the wire never carries because
 * the server owns them:
 *
 * - each media item's `type`/`width`/`height` — derived once, at upload,
 *   from the bytes themselves — and, for a video, `poster`: a still frame
 *   ingest writes for the grid to draw instead of loading the clip. Neither
 *   is a wire concept; both are lost if this file does not keep them.
 *
 * `status` is required here rather than the wire's optional literal
 * `"draft"`, because a file on disk is always one or the other — this type
 * has to speak for a published day too, which the write shape refuses to
 * describe (publishing is a separate call, not a value the wire ever sends).
 *
 * `weather` is exactly the wire's own field: `true` (asked, unanswered) or a
 * reading. There is no second disk-only key for it — the server's own
 * fetched reading is simply a reading whose `source` happens to be
 * `open-meteo`; nothing about "was this asked for" needs its own address
 * once the reading itself is on the day.
 */
export type DayFile = Omit<DayWriteShape, "status" | "media"> & {
  status: "draft" | "published";
  media?: (DayMediaWire & {
    type: "image" | "video";
    width?: number;
    height?: number;
    /** A still from a clip, for the grid — video items only. */
    poster?: string;
  })[];
};

/**
 * v1's per-field decline encoding for `costs` — `costs: false` ("nothing
 * spent") or `costs: "unknown"` ("figures lost") — retired in favour of the
 * one `declined` mechanism. A file still carrying it predates v2; read and
 * thrown away rather than round-tripped, because turning it into a
 * `declined` entry is the replay migrator's job, not this serializer's.
 */
function isRetiredCostsDecline(value: unknown): boolean {
  return value === false || value === "unknown";
}

/**
 * A day document → the bytes of `entries/YYYY-MM-DD-slug.json`.
 *
 * Key order is fixed so that serialising the same document twice matches
 * byte-for-byte: a diff in git is then always a change in content, never a
 * change in this function's mood. `JSON.stringify` walks own-enumerable
 * keys in insertion order, so building the object literal in the documented
 * order below is the whole mechanism — no recursive key-sorter needed.
 *
 * `JSON.stringify` drops any property whose value is `undefined`,
 * including nested ones, on its own: no `pruneUndefined` pass is needed
 * here the way `matter.stringify` needed one (that YAML emitter threw on an
 * `undefined` it met anywhere in the tree — B1601 — because it was never
 * built to encounter one). `undefined` inside an array element is the one
 * case where the two disagree with a naive expectation: `JSON.stringify`
 * turns it into `null` rather than dropping the slot, matching the old
 * pruner's own choice for the same case (an array element being absent is a
 * different fact from an object property being absent — the array still
 * has that many slots) and covered by the same test.
 *
 * Two-space indent and a trailing newline, so the file reads like every
 * other formatted JSON file in this repository and diffs cleanly.
 *
 * `slug` is never written here — same rule as before, unchanged by the
 * move to JSON: the filename IS the slug, and a second copy of it inside
 * the file is a second address for one fact to drift from the first.
 */
export function dayToJson(day: DayFile): string {
  const data: Record<string, unknown> = {
    title: day.title,
    date: day.date,
    time: day.time,
    timezone: day.timezone,
    location: day.location,
    country: day.country,
    countryCode: day.countryCode,
    coordinates: day.coordinates,
    content: day.content,
    media: day.media,
    costs: day.costs,
    transportMode: day.transportMode,
    transportFrom: day.transportFrom,
    transportTo: day.transportTo,
    tags: day.tags,
    translations: day.translations,
    visibility: day.visibility,
    weather: day.weather,
    travelScene: day.travelScene,
    test: day.test,
    declined: day.declined,
    status: day.status,
  };

  return JSON.stringify(data, null, 2) + "\n";
}

/** A day file's raw bytes → the v2 day document. `slug` comes from the
 * filename, never from the document — the document never carries one. */
export function dayFromJson(slug: string, raw: string): DayFile {
  // A file that is not valid JSON is not a day with everything blank — it
  // is a day this function cannot read, and the caller (the route that
  // reads the day back, or the replay migrator) has to know that rather
  // than receive an empty, publishable-looking document. Throwing here,
  // rather than catching and returning a stub, is what keeps that decision
  // out of this function's hands.
  const data: Record<string, unknown> = JSON.parse(raw);

  const day: DayFile = {
    slug,
    title: data.title as string,
    date: data.date as string,
    content: (data.content as string | undefined) ?? "",
    // Anything that is not exactly "published" reads as a draft — a missing
    // key, a typo, a half-written file. v2 always writes this key, so the
    // case should not arise; when it does, the failure has to fall on the
    // side of *not* putting something on the site. The same asymmetry
    // governs `visibility` on a trip (lib/trips.ts): an unrecognised value
    // reads as private, never as public, because a typo must not publish
    // somebody's day.
    status: data.status === "published" ? "published" : "draft",
  };

  if (data.time !== undefined) day.time = data.time as DayFile["time"];
  if (data.timezone !== undefined) day.timezone = data.timezone as DayFile["timezone"];
  if (data.location !== undefined) day.location = data.location as DayFile["location"];
  if (data.country !== undefined) day.country = data.country as DayFile["country"];
  if (data.countryCode !== undefined) day.countryCode = data.countryCode as DayFile["countryCode"];
  if (data.coordinates !== undefined) day.coordinates = data.coordinates as DayFile["coordinates"];
  if (data.media !== undefined) day.media = data.media as DayFile["media"];
  if (data.costs !== undefined && !isRetiredCostsDecline(data.costs)) {
    day.costs = data.costs as DayFile["costs"];
  }
  if (data.transportMode !== undefined) day.transportMode = data.transportMode as DayFile["transportMode"];
  if (data.transportFrom !== undefined) day.transportFrom = data.transportFrom as DayFile["transportFrom"];
  if (data.transportTo !== undefined) day.transportTo = data.transportTo as DayFile["transportTo"];
  if (data.tags !== undefined) day.tags = data.tags as DayFile["tags"];
  if (data.translations !== undefined) day.translations = data.translations as DayFile["translations"];
  if (data.visibility !== undefined) day.visibility = data.visibility as DayFile["visibility"];
  if (data.weather !== undefined) day.weather = data.weather as DayFile["weather"];
  if (data.travelScene !== undefined) day.travelScene = data.travelScene as DayFile["travelScene"];
  if (data.test !== undefined) day.test = data.test as DayFile["test"];
  if (data.declined !== undefined) day.declined = data.declined as DayFile["declined"];

  // v1's per-field decline keys (`without`, `unrecorded`, `coordinates:
  // false`, `photos: false` — B531/B560) and its nested `transport:` block
  // are read by nothing here and never round-tripped. A file still carrying
  // one predates v2; translating it is the replay migrator's job, not this
  // serializer's.

  return day;
}

/** ── trip ────────────────────────────────────────────────────────────── */

type TripCreateShape = z.infer<typeof tripCreate>;

/**
 * The v2 trip document, unchanged from the wire — `costs` and `plan` are
 * still sections of one document here, and (since B1606) sections of one
 * *file* too: the only reason `trip.md`, `costs.md` and `plan.md` were ever
 * three files was that each had a real prose body a person reads, and JSON
 * has no prose-vs-frontmatter split to keep that argument alive. One fact,
 * one address.
 */
export type TripFile = Omit<TripCreateShape, "days">;

/**
 * A trip document → the bytes of `trip.json`. `costs` absent (declined, or
 * never brought) produces no `costs` key at all — an absent key IS the
 * absence, and the document's own `declined` map is what says why; nothing
 * is synthesised here. Same for `plan`.
 *
 * Key order fixed for the same reason as `dayToJson`: a diff in git means a
 * change in content, never a change in this function's mood.
 */
export function tripToJson(trip: TripFile): string {
  const data: Record<string, unknown> = {
    id: trip.id,
    title: trip.title,
    tagline: trip.tagline,
    dates: trip.dates,
    visibility: trip.visibility,
    listed: trip.listed,
    teaser: trip.teaser,
    test: trip.test,
    accent: trip.accent,
    cover: trip.cover,
    people: trip.people,
    rates: trip.rates,
    figures: trip.figures,
    translations: trip.translations,
    intro: trip.intro,
    costs: trip.costs,
    plan: trip.plan,
    declined: trip.declined,
  };

  return JSON.stringify(data, null, 2) + "\n";
}

/** `trip.json`'s raw bytes → the v2 trip document. `id` is read from the
 * document (unlike a day's `slug`) because it already lived in the
 * document before this file existed — only the *folder name* must never be
 * read from it, since that is a filesystem fact the caller owns. */
export function tripFromJson(raw: string): TripFile {
  const data: Record<string, unknown> = JSON.parse(raw);

  const trip: TripFile = {
    id: data.id as string,
    title: data.title as string,
    dates: data.dates as TripFile["dates"],
    visibility: data.visibility as TripFile["visibility"],
    people: data.people as TripFile["people"],
  };

  if (data.intro !== undefined) trip.intro = data.intro as TripFile["intro"];
  if (data.tagline !== undefined) trip.tagline = data.tagline as TripFile["tagline"];
  if (data.listed !== undefined) trip.listed = data.listed as TripFile["listed"];
  if (data.teaser !== undefined) trip.teaser = data.teaser as TripFile["teaser"];
  if (data.test !== undefined) trip.test = data.test as TripFile["test"];
  if (data.accent !== undefined) trip.accent = data.accent as TripFile["accent"];
  if (data.cover !== undefined) trip.cover = data.cover as TripFile["cover"];
  if (data.rates !== undefined) trip.rates = data.rates as TripFile["rates"];
  if (data.figures !== undefined) trip.figures = data.figures as TripFile["figures"];
  if (data.translations !== undefined) trip.translations = data.translations as TripFile["translations"];
  if (data.costs !== undefined) trip.costs = data.costs as TripFile["costs"];
  if (data.plan !== undefined) trip.plan = data.plan as TripFile["plan"];
  if (data.declined !== undefined) trip.declined = data.declined as TripFile["declined"];

  // v1's `travellers`, `tracks`, `status`, `startLocation`, `ratesFrom`,
  // `costsVisibility`, `reminder` and `reminderChannel` are read by nothing
  // here and never round-tripped — `travellers` is superseded by the figure
  // library, `tracks` and `costsVisibility` (now `costs.visibility`) by
  // their v2 homes, `status` is derived rather than stored, and the rest
  // never had a v2 home to begin with.

  return trip;
}

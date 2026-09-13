import fs from "node:fs";
import path from "node:path";
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";
import { createTrip } from "@/lib/tripWrite";
import { dayToJson, type DayFile } from "@/lib/api/v2/documents";
import { TRANSPORT_MODES } from "@/lib/validate/entry";
import { COST_CATEGORIES } from "@/lib/costFormat";

/**
 * The one place that knows how a trip and a day are stored on disk — B1630.
 *
 * Fifty test files hand-rolled their own `writeEntry`/`writeTrip`, each a
 * private copy of the v1 markdown shape. That is fine until the shape
 * changes: B1598 moves the reader (`lib/entries.ts`, `lib/trips.ts`) off
 * markdown, and a naive migration would mean editing fifty files instead of
 * one. This module is what makes it one file: everything below speaks about
 * a trip and a day as *concepts* (an id, a title, dates, people, a slug, a
 * coordinate, a photograph) and never a YAML key or a file extension. When
 * B1598 lands, only the bodies of `writeTripFixture` and `writeDayFixture`
 * change — no caller does.
 *
 * `writeTripFixture` goes through the real writer, `createTrip` in
 * `lib/tripWrite.ts` — a fixture built on the production serializer cannot
 * drift from what it serializes. `writeDayFixture` does not: `createDraft`
 * (`lib/api/entries.ts`) only ever writes `status: draft`, mints its own slug
 * from the title, and has no way to attach a gallery item without a real
 * upload going through `lib/photos.ts`'s media pipeline. Most callers need a
 * published day, a slug independent of the title, and gallery entries that
 * point at fixture JPEGs already on disk — none of which `createDraft` can
 * do — so the day writer hand-assembles the frontmatter, the same shape the
 * fifty local copies did.
 */

/** Caller-supplied identity of the journal a trip is written into. Callers
 * are expected to have already put `content/<user>/config.json` on disk —
 * this module writes trips and days, not journals. */
export type TripFixture = {
  id: string;
  title?: string;
  start: string;
  end: string;
  status?: "upcoming" | "current" | "past";
  visibility?: "private" | "public" | "guest";
  listed?: boolean;
  teaser?: boolean;
  costsVisibility?: "public" | "guests";
  test?: boolean;
  people?: Array<{ name: string; email: string; nickname?: string }>;
  intro?: string;
  /** Widened with the day's, and for the same reason — B1630. */
  accent?: string;
  tagline?: string;
  translations?: Record<string, { title?: string; tagline?: string; intro?: string }>;
  plan?: { route: Array<Record<string, unknown>>; body?: string };
  costs?: { budget: { total: number; days?: number; currency?: string }; items?: Array<Record<string, unknown>>; note?: string; visibility?: "public" | "guests" };
  rates?: { currencies: string[]; manual?: Record<string, number> };
  declined?: Record<string, string>;
};

/**
 * Write a trip through the real writer.
 *
 * Requires `process.env.CONTENT_DIR` to already point at the fixture root
 * and `content/<user>/config.json` to already exist — `createTrip` reads the
 * user before it writes anything. Throws on refusal: a fixture that failed
 * to set itself up is a bug in the test, not a case to assert on (a test
 * that means to exercise `createTrip`'s own refusals should call it
 * directly, not through this helper).
 */
export function writeTripFixture(username: string, trip: TripFixture): { ref: string } {
  const result = createTrip(username, {
    id: trip.id,
    title: trip.title ?? trip.id,
    start: trip.start,
    end: trip.end,
    status: trip.status,
    visibility: trip.visibility,
    listed: trip.listed,
    teaser: trip.teaser,
    costsVisibility: trip.costsVisibility,
    test: trip.test,
    people: trip.people,
    intro: trip.intro ?? "Intro.",
  });
  if (!result.ok) {
    throw new Error(`writeTripFixture(${username}/${trip.id}) failed: ${result.error}`);
  }

  // The sections `createTrip` does not take, applied to the document it just
  // wrote — B1630. Still through the real store, so the bytes are what the
  // production writer produces; `createTrip` simply has no argument for a
  // trip's plan, costs, rates or translations, and a fixture that needs one
  // was otherwise forced to bypass this helper and hand-roll the whole
  // document, which is the duplication this exists to remove.
  const extras: Record<string, unknown> = {};
  if (trip.accent !== undefined) extras.accent = trip.accent;
  if (trip.tagline !== undefined) extras.tagline = trip.tagline;
  if (trip.translations !== undefined) extras.translations = trip.translations;
  if (trip.plan !== undefined) extras.plan = trip.plan;
  if (trip.costs !== undefined) extras.costs = trip.costs;
  if (trip.rates !== undefined) extras.rates = trip.rates;
  if (trip.declined !== undefined) extras.declined = trip.declined;
  if (Object.keys(extras).length > 0) {
    const stored = readTripFile(username, trip.id);
    if (!stored) throw new Error(`writeTripFixture(${username}/${trip.id}): written but unreadable`);
    writeTripFile(username, trip.id, { ...stored, ...extras } as typeof stored);
  }

  return { ref: result.ref };
}

export type DayFixture = {
  slug: string;
  date: string;
  title?: string;
  time?: string;
  timezone?: string;
  location?: string;
  country?: string;
  countryCode?: string;
  coordinates?: { lat: number; lng: number };
  /** Gallery items — each `src` is a path the caller already wrote bytes to
   * (usually under the trip's `media/` folder). Maps to `gallery:`. */
  media?: Array<{
    src: string;
    type?: "image" | "video";
    caption?: string;
    /** A single photograph's own narrowing — B596. Independent of the day's. */
    visibility?: "guest" | "private";
  }>;
  /** Present and `"draft"` to withhold the day; absent means published —
   * the same default `lib/entries.ts` reads. */
  status?: "draft";
  /** The per-photo/per-day visibility narrowing, B596/B632. */
  visibility?: "guest" | "private";
  test?: boolean;
  content?: string;
  /** Widened after the first repointing pass — B1630. Nine files had to
   * bypass the helper for one of these and reach for `dayToJson` directly,
   * which is exactly the duplication this exists to remove. Each is a real
   * thing a day has, not a frontmatter detail. */
  costs?: Array<{ label: string; amount: number; category?: (typeof COST_CATEGORIES)[number]; currency?: string }>;
  translations?: Record<string, { title: string; content: string }>;
  /** `true` asks the server to look it up; an object IS a reading, whose own
   * `source` says whose it is (open-meteo means this server fetched it).
   * Typed off `DayFile` rather than loosely, so the compiler enforces what
   * the contract enforces: a reading names where it came from and when. A
   * fixture able to write a sourceless reading could set up a test the
   * server would refuse. */
  weather?: DayFile["weather"];
  tags?: string[];
  transportMode?: (typeof TRANSPORT_MODES)[number];
  travelScene?: DayFile["travelScene"];
  /** What this day consciously has none of, and why — the one decline
   * mechanism, replacing v1's `without:`/`unrecorded:`/`costs: false`. */
  declined?: Record<string, string>;
};

/**
 * Write a day's JSON directly (B1598).
 *
 * Not routed through `createDraft` — see the module comment for why. Writes
 * exactly the v2 shape `lib/entries.ts` reads (`dayToJson`, the production
 * serialiser) so a fixture cannot drift from what it emits, even though the
 * object is assembled here rather than passed through the write API.
 */
export function writeDayFixture(
  root: string,
  username: string,
  tripId: string,
  day: DayFixture,
): { file: string } {
  const entriesDir = path.join(root, username, "trips", tripId, "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  const file = path.join(entriesDir, `${day.date}-${day.slug}.json`);

  const doc: DayFile = {
    slug: day.slug,
    title: day.title ?? day.slug,
    date: day.date,
    content: day.content ?? "Something happened.",
    status: day.status === "draft" ? "draft" : "published",
    ...(day.time ? { time: day.time } : {}),
    ...(day.timezone ? { timezone: day.timezone } : {}),
    ...(day.location ? { location: day.location } : {}),
    ...(day.country ? { country: day.country } : {}),
    ...(day.countryCode ? { countryCode: day.countryCode } : {}),
    ...(day.coordinates ? { coordinates: day.coordinates } : {}),
    ...(day.media?.length
      ? {
          media: day.media.map((m) => ({
            src: m.src,
            type: m.type ?? "image",
            ...(m.caption ? { caption: m.caption } : {}),
            ...(m.visibility ? { visibility: m.visibility } : {}),
          })),
        }
      : {}),
    ...(day.visibility ? { visibility: day.visibility } : {}),
    ...(day.costs ? { costs: day.costs } : {}),
    ...(day.translations ? { translations: day.translations } : {}),
    ...(day.weather !== undefined ? { weather: day.weather } : {}),
    ...(day.tags ? { tags: day.tags } : {}),
    ...(day.transportMode ? { transportMode: day.transportMode } : {}),
    ...(day.travelScene ? { travelScene: day.travelScene } : {}),
    ...(day.declined ? { declined: day.declined } : {}),
    ...(day.test ? { test: true } : {}),
  };

  fs.writeFileSync(file, dayToJson(doc));
  return { file };
}

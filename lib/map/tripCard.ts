import "server-only";
import { readerTrack } from "../gps/track";
import { kmBetween } from "../mapFrame";
import type { DaySummary, Trip } from "../types";
import { tripCardSvg, dayCardSvg, hasStreetRegion, type CardResult, type Scheme } from "./cardSvg";
import type { MapPlace, RecordedSegment } from "./tripFrame";

export type { Scheme } from "./cardSvg";

/** What the facts line needs beside the SVG itself. */
export type TripCard = {
  card: CardResult;
  /** Total ground distance across every recorded (non-gap) segment — the
   * facts line's "415 km recorded". Rounded to the nearest km; 0 for a
   * photo-only trip, which is why the caller only shows this tile when it is
   * positive, the same "absence beats a fake zero" rule `TripHero`'s own
   * `hasPlaces` already follows (B1260). */
  recordedKm: number;
};

/**
 * What a page needs to lay the card out *without* rendering it — B2538,
 * item 3. The SVG itself is now fetched as `<img src>` from `/card.svg`
 * (`components/map/MapCard.tsx`), so a page render no longer has to decode
 * PMTiles (or even read the Natural Earth bundle) just to draw the
 * surrounding facts line and credit; only the image route does that, once,
 * with the result cached to disk for every later request.
 */
export type CardMeta = {
  recordedKm: number;
  /** Whether the OSM credit line should show — cheap (`hasStreetRegion`),
   * not a guarantee the render will actually reach a tile inside the
   * region's own bbox; see that function's own doc. */
  usedStreet: boolean;
  /** The `card.svg` route's own query string for this card — `""` for the
   * trip-wide one, `"?day=<date>"` for a single day's. Append to
   * `<trip base>/card.svg`. */
  query: string;
};

function totalKm(recorded: readonly RecordedSegment[]): number {
  let km = 0;
  for (const seg of recorded) {
    // A synthetic gap bridge (see `recordedFrom`) is drawn, not recorded —
    // it must not inflate "415 km recorded" with a distance nobody's device
    // actually measured.
    if (seg.gap) continue;
    for (let i = 1; i < seg.points.length; i++) km += kmBetween(seg.points[i - 1], seg.points[i]);
  }
  return Math.round(km);
}

/** README: "a recorded gap (no position for > 10 min and > 600 m): thin
 * dashed." Metres are real, always — every point here is a real fix. Minutes
 * are real when two adjacent kept segments both carry a `from` timestamp
 * (`TrackSegment.from`, the only per-point time this store keeps — a
 * segment's own interior points carry none); when one is missing, the test
 * falls back to distance alone rather than guessing an elapsed time. */
const GAP_METRES = 600;
const GAP_MS = 10 * 60 * 1000;

/**
 * The two card builders every story/day page calls — B2538. `index` is
 * whatever `buildStoryProps` already resolved for this reader (drafts and
 * visibility applied), the same array `TripHero`'s `route` prop and
 * `tripTrackFor` are built from, so a place or a recorded segment neither of
 * those may show is never handed to the card either.
 */

function placesFrom(index: readonly DaySummary[]): MapPlace[] {
  return index
    .map((d, i) => ({ day: i + 1, date: d.date, lat: d.lat, lng: d.lng, name: d.location }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/**
 * The trip's recorded line, reshaped from `TrackSegment` (keyed by date) to
 * `RecordedSegment` (keyed by day number) — `lib/map/tripFrame.ts`'s own
 * currency, chosen so a name repeated across a merged run of days still
 * reads as the day it was (see that module's own doc). `readerTrack`
 * defaults `live` to `false`, which is the whole point here: "readers only
 * ever see reader-filtered data (readerTrack without live for the card;
 * the live tail is map-page only)".
 */
/** Exported for `test/trip-view-track.test.ts` (B2449) — the guarantee that
 * matters is that a draft day's recorded line never reaches this function's
 * output, and asserting on its own return is more direct than reading it
 * back out of a rendered SVG or a rounded km total. */
export function recordedFrom(trip: Trip, index: readonly Pick<DaySummary, "date">[]): RecordedSegment[] {
  const dayNumber = new Map(index.map((d, i) => [d.date, i + 1]));
  const track = readerTrack(trip.username, trip.id, new Set(index.map((d) => d.date)));
  if (!track) return [];

  const kept: { day: number; fromMs: number; points: { lat: number; lng: number }[] }[] = [];
  for (const seg of track.segments) {
    if (!seg.day || seg.points.length < 2) continue;
    const day = dayNumber.get(seg.day);
    if (day === undefined) continue;
    kept.push({
      day,
      fromMs: Date.parse(seg.from),
      points: seg.points.map(([lat, lng]) => ({ lat, lng })),
    });
  }
  // Trip order, then start time within a day — the order a gap between two
  // consecutive runs is measured in.
  kept.sort((a, b) => a.day - b.day || a.fromMs - b.fromMs);

  const out: RecordedSegment[] = [];
  for (let i = 0; i < kept.length; i++) {
    out.push({ day: kept[i].day, points: kept[i].points });
    const next = kept[i + 1];
    if (!next) continue;
    const last = kept[i].points[kept[i].points.length - 1];
    const first = next.points[0];
    const metres = kmBetween(last, first) * 1000;
    if (metres <= GAP_METRES) continue;
    const bothTimed = Number.isFinite(kept[i].fromMs) && Number.isFinite(next.fromMs);
    const longEnough = !bothTimed || next.fromMs - kept[i].fromMs > GAP_MS;
    if (longEnough) out.push({ day: next.day, points: [last, first], gap: true });
  }
  return out;
}

/** The trip page's own card — the whole route, every day numbered. `null`
 * when nothing on the trip has ever carried a coordinate (B1260: no place
 * beats a plausible-looking blank map). Renders the actual SVG — only the
 * `card.svg` route calls this; a page wanting the surrounding facts line
 * and nothing else wants `tripCardMeta` below instead. */
export async function tripCardFor(
  trip: Trip,
  index: readonly DaySummary[],
  scheme: Scheme,
): Promise<TripCard | null> {
  const places = placesFrom(index);
  if (places.length === 0) return null;
  const recorded = recordedFrom(trip, index);
  const card = await tripCardSvg(trip.username, trip.id, places, recorded, scheme);
  if (!card) return null;
  return { card, recordedKm: totalKm(recorded) };
}

/** One day's own card — only the `/card.svg?day=…` route calls this
 * (`app/at/[user]/card.svg/route.ts` and its `/trips/<id>` twin); a page
 * itself never needs the render, only `isPlottable` on the day's own
 * `DaySummary` to decide whether to point an `<img>` at it at all. `null`
 * for a day with no place of its own. */
export async function dayCardFor(
  trip: Trip,
  index: readonly DaySummary[],
  date: string,
  scheme: Scheme,
): Promise<TripCard | null> {
  const places = placesFrom(index);
  if (places.length === 0) return null;
  const day = index.findIndex((d) => d.date === date) + 1;
  if (day <= 0) return null;
  const recorded = recordedFrom(trip, index);
  const card = await dayCardSvg(trip.username, trip.id, places, recorded, day, scheme);
  if (!card) return null;
  return { card, recordedKm: totalKm(recorded.filter((s) => s.day === day)) };
}

/** `tripCardFor` without the render — a page's own use (the facts line, the
 * credit line, the `<img src>` to point at) never needs the SVG itself. */
export function tripCardMeta(trip: Trip, index: readonly DaySummary[]): CardMeta | null {
  if (placesFrom(index).length === 0) return null;
  return {
    recordedKm: totalKm(recordedFrom(trip, index)),
    usedStreet: hasStreetRegion(trip.username, trip.id),
    query: "",
  };
}


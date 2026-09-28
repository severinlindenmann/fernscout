import "server-only";
import { readerTrack } from "../gps/track";
import { kmBetween } from "../mapFrame";
import type { DaySummary, Trip } from "../types";
import { tripCardSvg, dayCardSvg, type CardResult } from "./cardSvg";
import type { MapPlace, RecordedSegment } from "./tripFrame";

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

function totalKm(recorded: readonly RecordedSegment[]): number {
  let km = 0;
  for (const seg of recorded) {
    for (let i = 1; i < seg.points.length; i++) km += kmBetween(seg.points[i - 1], seg.points[i]);
  }
  return Math.round(km);
}

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
  const out: RecordedSegment[] = [];
  for (const seg of track.segments) {
    if (!seg.day || seg.points.length < 2) continue;
    const day = dayNumber.get(seg.day);
    if (day === undefined) continue;
    out.push({ day, points: seg.points.map(([lat, lng]) => ({ lat, lng })) });
  }
  return out;
}

/** The trip page's own card — the whole route, every day numbered. `null`
 * when nothing on the trip has ever carried a coordinate (B1260: no place
 * beats a plausible-looking blank map). */
export async function tripCardFor(trip: Trip, index: readonly DaySummary[]): Promise<TripCard | null> {
  const places = placesFrom(index);
  if (places.length === 0) return null;
  const recorded = recordedFrom(trip, index);
  const card = await tripCardSvg(trip.username, trip.id, places, recorded);
  if (!card) return null;
  return { card, recordedKm: totalKm(recorded) };
}

/** One day's own card, for a `/day/<slug>` permalink. `null` for a day with
 * no place of its own — the caller's cue to draw nothing at all. */
export async function dayCardFor(
  trip: Trip,
  index: readonly DaySummary[],
  date: string,
): Promise<TripCard | null> {
  const places = placesFrom(index);
  if (places.length === 0) return null;
  const day = index.findIndex((d) => d.date === date) + 1;
  if (day <= 0) return null;
  const recorded = recordedFrom(trip, index);
  const card = await dayCardSvg(trip.username, trip.id, places, recorded, day);
  if (!card) return null;
  return { card, recordedKm: totalKm(recorded.filter((s) => s.day === day)) };
}

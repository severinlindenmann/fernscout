import "server-only";
import { kmBetween } from "../mapFrame";
import { placeEntry } from "../entries";
import type { Day } from "../types";
import { readTrack } from "../gps/track";
import { townNameFor } from "./townName";

/**
 * A day's position taken from the middle of its recorded route, else of its
 * located photographs — the last sources in the order tagged place > recorded
 * route > photo pins > none.
 * Derived when the map is drawn, from what `readerTrack` already let this
 * reader see; never written into an entry.
 */
export type DayAnchor = { lat: number; lng: number; name: string };

export function dayAnchors(
  days: readonly Day[],
  trackByDay: readonly { date?: string; points: [number, number][] }[],
  /** Located photographs, after the track: a day with only these is placed from them (B-2980). */
  pins: readonly { date: string; lat: number; lng: number }[] = [],
): Map<string, DayAnchor> {
  const out = new Map<string, DayAnchor>();
  for (const day of days) {
    const lead = placeEntry(day);
    if (Number.isFinite(lead.lat) && Number.isFinite(lead.lng)) continue;
    let pts = trackByDay.filter((s) => s.date === day.date).flatMap((s) => s.points);
    if (pts.length === 0) pts = pins.filter((p) => p.date === day.date).map((p): [number, number] => [p.lat, p.lng]);
    if (pts.length === 0) continue;
    const c = {
      lat: pts.reduce((n, p) => n + p[0], 0) / pts.length,
      lng: pts.reduce((n, p) => n + p[1], 0) / pts.length,
    };
    // Medoid: the recorded point nearest the centroid, so the anchor is on the
    // road rather than in a lake the route curves around.
    let best = pts[0];
    for (const p of pts) {
      if (kmBetween({ lat: p[0], lng: p[1] }, c) < kmBetween({ lat: best[0], lng: best[1] }, c)) best = p;
    }
    out.set(day.date, { lat: best[0], lng: best[1], name: townNameFor(best[0], best[1], "") });
  }
  return out;
}

/**
 * Owner only (the caller checks): recorded days that have no entry at all.
 * Reads the derived `track.json` through `readTrack` — never the GPS store —
 * and returns dates plus the muted lines for them. Nothing is composed.
 */
export function unwrittenRecordedDays(
  username: string,
  tripId: string,
  writtenDates: ReadonlySet<string>,
): { dates: string[]; lines: [number, number][][] } {
  const segs = (readTrack(username, tripId)?.segments ?? []).filter((s) => s.day && !writtenDates.has(s.day));
  return { dates: [...new Set(segs.map((s) => s.day as string))].sort(), lines: segs.map((s) => s.points) };
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getAllEntries, getPlaces, type ReadOptions } from "./entries";
import { hasHappened } from "./tripTime";
import { tripDir } from "./trips";
import type { PlanProgress, PlannedStop } from "./types";

/** How close a real stop has to be to count as having reached a planned one.
 * Generous on purpose: "Zurich Airport" is 11km from "Zurich", and nobody
 * writing an entry from a night bus should have to match a name exactly. */
const REACHED_KM = 75;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

type RawStop = Partial<Record<keyof PlannedStop, unknown>>;

/**
 * The intended route with each stop marked reached or not.
 *
 * Returns an empty plan when content/plan.md is absent or malformed rather
 * than throwing — the plan is a nice-to-have layer on the map, and a typo in
 * it shouldn't take the map down.
 *
 * `{ includeDrafts: true }` additionally folds in future-dated draft entries
 * (W33): an agent drafting the next few days with coordinates is, in effect,
 * extending the route by hand — writing the same stop into `plan.md` too
 * would just be a second place for it to go stale. This is the one path in
 * the codebase allowed to read draft coordinates into something rendered on
 * the map, and it must only ever be called with `includeDrafts: true` for
 * somebody `draftsVisibleTo` has said yes to — callers are responsible for
 * that check (see the map and countdown pages), because by the time a stop
 * reaches this function there is nothing left to distinguish "from a draft"
 * from "hand-written", and a reader must not learn where somebody is going
 * next.
 *
 * That audience was the trip's owner alone until B327 and is now the owner
 * *or* somebody holding a place on the trip. The sentence above still holds
 * for the reader it was written about: somebody on the trip is not "a reader"
 * in that sense, they are on the bus, and where it goes next is not a secret
 * from them.
 */
export function getPlan(tripId: string, options: ReadOptions = {}): PlanProgress {
  const file = path.join(tripDir(tripId), "plan.md");
  const written = fs.existsSync(file) ? readPlanFile(file, tripId) : [];
  const stops = options.includeDrafts
    ? mergeDraftStops(tripId, written)
    : written;

  const reachedCount = stops.filter((s) => s.reached).length;
  return { stops, reachedCount, next: stops.find((s) => !s.reached) };
}

/** The hand-written route from plan.md, each stop marked reached or not. */
function readPlanFile(file: string, tripId: string): PlannedStop[] {
  const { data } = matter(fs.readFileSync(file, "utf8"));
  const raw = Array.isArray(data.route) ? (data.route as RawStop[]) : [];

  // A plan.md that parses to nothing is the failure worth naming: the file
  // exists, the author believes there is a route, and the map silently draws
  // none. Wrong key, wrong shape or wrong field names all land here.
  if (raw.length === 0) {
    console.warn(
      `[plan] ${file} has no usable \`route:\` list — expected ` +
        `route: [{ location, lat, lng }]. The planned route will not be drawn.`,
    );
  }
  const visited = getPlaces(tripId).map((p) => ({ lat: p.lat, lng: p.lng }));

  const stops: PlannedStop[] = raw
    .map((r) => ({
      location: String(r.location ?? "").trim(),
      country: String(r.country ?? "").trim(),
      countryCode: r.countryCode ? String(r.countryCode) : undefined,
      lat: Number(r.lat),
      lng: Number(r.lng),
      note: r.note ? String(r.note) : undefined,
      reached: false,
    }))
    .filter((s) => s.location && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => ({
      ...s,
      reached: visited.some((v) => haversineKm(v, s) <= REACHED_KM),
    }));

  // The final stop is the flight home, which shares coordinates with the
  // first — so it would read as "reached" from day one. It only counts once
  // everything before it has been. Indexes into `stops` alone: this runs
  // before any draft-derived stops are appended, so "last" still means the
  // last hand-written one, not whatever a draft happened to add after it.
  const last = stops.length - 1;
  if (last > 0 && !stops.slice(0, last).every((s) => s.reached)) {
    stops[last] = { ...stops[last], reached: false };
  }

  return stops;
}

/**
 * `written` plus one stop per future, coordinate-bearing draft — skipping any
 * draft within REACHED_KM of a stop already in the list, hand-written or
 * already-added, so the same place written twice (once by hand, once by an
 * agent) draws once. Draft stops are sorted by date among themselves and
 * appended after the hand-written route, which is the only order available
 * without inventing dates for plan.md's stops too.
 */
function mergeDraftStops(tripId: string, written: PlannedStop[]): PlannedStop[] {
  const visited = getPlaces(tripId).map((p) => ({ lat: p.lat, lng: p.lng }));

  const draftStops: PlannedStop[] = getAllEntries(tripId, { includeDrafts: true })
    .filter(
      (e) => e.draft && Number.isFinite(e.lat) && Number.isFinite(e.lng) && !hasHappened(e.date),
    )
    .map((e) => ({
      location: e.location,
      country: e.country,
      countryCode: e.countryCode,
      lat: e.lat,
      lng: e.lng,
      date: e.date,
      fromDraft: true,
      reached: visited.some((v) => haversineKm(v, e) <= REACHED_KM),
    }))
    .sort((a, b) => a.date!.localeCompare(b.date!));

  const merged = [...written];
  for (const stop of draftStops) {
    if (merged.some((s) => haversineKm(s, stop) <= REACHED_KM)) continue;
    merged.push(stop);
  }
  return merged;
}

import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { metresBetween } from "./store";
import type { Fix } from "../../importers/gps/schema";

/**
 * What a reader must never see of one trip's recorded route — B2539, D8 C.
 *
 * `content/<user>/trips/<trip>/track-edits.json`: the owner's own decisions
 * about *this trip's* line, never the line itself. A hidden spot is a
 * circle, the same shape as a private zone (`./enrich.ts`'s `ExcludeZone`)
 * but scoped to one trip rather than the whole journal — a friend's flat
 * visited once is not "everywhere I have ever been near". A hidden stretch
 * is a time range with nothing to say about it. A named stretch is the same
 * time range with something to say — "Boat trip · dolphins" instead of
 * whatever a phone's own best guess at transport mode invents (the Algarve
 * find that started this ticket: a 43 km "car ride" that was a boat).
 *
 * **Never deletes a position.** Every rule here is read at derivation time
 * (`deriveTrack`, `./enrich.ts`) the same way a private zone already is —
 * the store keeps every fix; what a reader is ever shown is what changes.
 *
 * **Decided as trip content, not private-store content, and excluded from
 * export and sync anyway.** Unlike `exclude.json` (journal-wide, and never
 * inside `trips/` at all so it is structurally out of every trip export),
 * a hidden spot or stretch is inherently about one trip's own line, so it
 * belongs in the trip's own folder the way `track.json` and
 * `track-recent.json` already do. But it still carries coordinates the
 * owner chose and times they picked to say "nobody outside this journal may
 * see this" — the same fact `track-recent.json` is excluded from every
 * export and from the sync manifest for (`lib/exportZip.ts`,
 * `lib/sync/manifest.ts`). This file gets the same two exclusions: it is
 * the owner's own settings, read back only through the doors below, never
 * bundled with the rest of the trip.
 *
 * Doors: `GET`/`PUT /api/v2/{user}/trips/{trip}/track-edits` (owner token
 * only — `requireJournalOwner`, same as `gps/zones`: a trip-scoped token is
 * refused even for its own trip, because deriving what a reader sees from
 * this file touches the whole of `deriveTripTrack`, not a trip-scoped
 * write). `app/api/web/{user}/trips/{trip}/track-edits` is the owner's
 * cookie-only twin.
 */
export type HiddenSpot = { id: string; lat: number; lon: number; radiusM: number };
export type HiddenStretch = { id: string; from: string; to: string };
export type NamedStretch = { id: string; from: string; to: string; label: string };

export type TrackEdits = {
  hiddenSpots: HiddenSpot[];
  hiddenStretches: HiddenStretch[];
  namedStretches: NamedStretch[];
};

const EMPTY_EDITS: TrackEdits = { hiddenSpots: [], hiddenStretches: [], namedStretches: [] };

export const EDIT_LIMITS = {
  /** Same order of magnitude as `ZONE_LIMITS.maxZones` — enough for a
   * handful of mistakes and private corners on one trip, nowhere near
   * enough to redraw the whole route by hand. */
  maxSpots: 20,
  maxStretches: 20,
  maxNamed: 20,
  /** Same bounds as `ZONE_LIMITS` (`./enrich.ts`) — below 50 m a "hidden
   * spot" is thinner than most GPS receivers are accurate to, and above
   * 5 km it is not a spot any more. */
  minRadiusM: 50,
  maxRadiusM: 5_000,
  labelMax: 80,
} as const;

export function editsFile(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "track-edits.json");
}

/** Fails closed the same way `readExcludeZones` does: an unreadable file
 * must not be read as "nothing is hidden" — that would draw the line a
 * corrupt file was supposed to be cutting out of. Missing is the normal
 * case (most trips have no edits) and reads as empty. */
export function readTrackEdits(username: string, tripId: string): TrackEdits {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(editsFile(username, tripId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_EDITS;
    throw new Error(
      `${editsFile(username, tripId)} is unreadable — refusing to derive a track without it`,
    );
  }
  if (typeof raw !== "object" || raw === null) throw new Error(`${editsFile(username, tripId)} must be an object`);
  const doc = raw as Partial<TrackEdits>;
  return {
    hiddenSpots: Array.isArray(doc.hiddenSpots) ? doc.hiddenSpots : [],
    hiddenStretches: Array.isArray(doc.hiddenStretches) ? doc.hiddenStretches : [],
    namedStretches: Array.isArray(doc.namedStretches) ? doc.namedStretches : [],
  };
}

/** Written whole and renamed, the same as `./enrich.ts`'s own
 * `writeFileAtomic` — a reader must never see a half-written file. */
export function writeTrackEdits(username: string, tripId: string, edits: TrackEdits): void {
  const file = editsFile(username, tripId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(edits, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

/** Whether a fix falls inside any hidden spot — the same radius check
 * `isExcluded` (`./enrich.ts`) makes for a private zone, kept separate
 * because a hidden spot is scoped to one trip and a private zone is
 * journal-wide; conflating the two lists would apply a trip's own hidden
 * spot to every other trip too. */
export function isInHiddenSpot(fix: Fix, spots: HiddenSpot[]): boolean {
  return spots.some((spot) => metresBetween(fix, { t: 0, lat: spot.lat, lon: spot.lon }) <= spot.radiusM);
}

/** Whether an instant falls inside any hidden (or named — see the doc
 * comment on `deriveTrack`) stretch. Both share this check: naming a
 * stretch says something about it, it does not change whether it is
 * hidden — only `hiddenStretches` does that. */
export function isInStretch(t: number, stretches: { from: string; to: string }[]): boolean {
  return stretches.some((s) => {
    const from = Date.parse(s.from);
    const to = Date.parse(s.to);
    return t >= from && t <= to;
  });
}

import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { isTransportMode, type TransportMode } from "../../importers/gps/schema";

/**
 * Great-circle metres — the same haversine `./store.ts` and
 * `lib/ingest/geo.ts` each already have, restated rather than imported for
 * the reason `./store.ts`'s own copy gives: this file is meant to be reached
 * from `./track.ts`, which `app/` reaches directly, and `./store.ts` is not
 * something anything under `app/` may import even transitively — restating
 * six lines keeps that boundary a straight line rather than something a
 * reader has to trace through this file to be sure of.
 */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = Math.PI / 180;
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dLat = (b.lat - a.lat) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin((dLon * toRad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

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
 * **A stretch is stored as a wall clock, not an instant — security review,
 * 2026-09-28.** The first cut of this stored a raw ISO instant, built in the
 * *browser's* own time zone; editing a Tokyo trip from Zürich silently hid
 * the wrong seven hours while the list echoed the typed times back as if
 * nothing had moved. `date` + `from`/`to` (`HH:MM`, both within that one
 * calendar date — a stretch does not cross midnight) is unambiguous however
 * it is read: it is always local to the day it names, the same "local to
 * the day, resolved fresh" rule `deriveTrack`'s own `windowsFor` already
 * uses for a trip date's window. Resolving it to an instant happens once, at
 * derivation time (`resolvedHiddenStretches`/`resolvedNamedStretches`,
 * `./api.ts`), against that date's own day `timezone` — never a browser's,
 * never the server's.
 *
 * **Never deletes a position.** Every rule here is read at derivation time
 * (`deriveTrack`, `./enrich.ts`) the same way a private zone already is —
 * the store keeps every fix; what a reader is ever shown is what changes.
 * Since the same security review, a hidden spot is *also* applied at serve
 * time (`readerTrack`, `./track.ts`) as a fallback that needs only
 * coordinates — so hiding a spot is immediate even when the store has
 * nothing left to re-derive from (after a purge, say). A hidden or named
 * *stretch* has no such fallback: telling a stored point's time apart from
 * any other needs the store itself, so a stretch only takes effect on the
 * next real derivation (an import, or `POST …/track`) — documented in
 * `docs/gps.md`.
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
 * `lib/sync/manifest.ts`). This file (and its own `.tmp` written mid-save,
 * same as every other atomic writer here) gets the same two exclusions: it
 * is the owner's own settings, read back only through the doors below,
 * never bundled with the rest of the trip.
 *
 * Doors: `GET`/`PUT /api/v2/{user}/trips/{trip}/track-edits` (owner token
 * only — `requireJournalOwner`, same as `gps/zones`: a trip-scoped token is
 * refused even for its own trip, because deriving what a reader sees from
 * this file touches the whole of `deriveTripTrack`, not a trip-scoped
 * write). `app/api/web/{user}/trips/{trip}/track-edits` is the owner's
 * cookie-only twin.
 */
export type HiddenSpot = { id: string; lat: number; lon: number; radiusM: number };
/** `date` (`YYYY-MM-DD`) plus `from`/`to` (`HH:MM`, `from < to`, both on that
 * one date) — a wall clock local to the day it names, not an instant. See
 * the module doc above for why. */
export type HiddenStretch = { id: string; date: string; from: string; to: string };
export type NamedStretch = {
  id: string;
  date: string;
  from: string;
  to: string;
  label: string;
  /** The owner's own chosen mode for this stretch — B2541. Overrides
   *  whatever the recorded fixes say for the stretch's own label, never the
   *  segment either side of it. Absent means "let the recording speak". */
  mode?: TransportMode;
};

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
  /** The longest an `id` this module will accept from a stored file is
   * allowed to be — malformed-file protection, mirrored by the write
   * schema's own bound (`lib/api/v2/schemas/trackEdits.ts`). */
  maxIdLength: 64,
} as const;

function editsFile(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "track-edits.json");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function badFile(username: string, tripId: string): never {
  throw new Error(
    `${editsFile(username, tripId)} is unreadable — refusing to derive a track without it`,
  );
}

/** Every rule a stored (or about-to-be-written) hidden spot must hold —
 * shared by `readTrackEdits`'s own validation and `writeTrackEdits`'s
 * pre-write check, so a bad row can never reach disk *or* survive being
 * read back from it. */
function validSpot(v: unknown): v is HiddenSpot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<HiddenSpot>;
  return (
    typeof s.id === "string" &&
    ID_RE.test(s.id) &&
    Number.isFinite(s.lat) &&
    (s.lat as number) >= -90 &&
    (s.lat as number) <= 90 &&
    Number.isFinite(s.lon) &&
    (s.lon as number) >= -180 &&
    (s.lon as number) <= 180 &&
    Number.isFinite(s.radiusM) &&
    (s.radiusM as number) >= EDIT_LIMITS.minRadiusM &&
    (s.radiusM as number) <= EDIT_LIMITS.maxRadiusM
  );
}

function validStretchShape(v: unknown): v is { id: string; date: string; from: string; to: string } {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<HiddenStretch>;
  return (
    typeof s.id === "string" &&
    ID_RE.test(s.id) &&
    typeof s.date === "string" &&
    DATE_RE.test(s.date) &&
    typeof s.from === "string" &&
    TIME_RE.test(s.from) &&
    typeof s.to === "string" &&
    TIME_RE.test(s.to) &&
    s.from < s.to
  );
}

function validNamedStretch(v: unknown): v is NamedStretch {
  if (!validStretchShape(v)) return false;
  const { label, mode } = v as Partial<NamedStretch>;
  if (typeof label !== "string" || label.trim().length === 0 || label.length > EDIT_LIMITS.labelMax) return false;
  return mode === undefined || isTransportMode(mode);
}

/** Fails closed the same way `readExcludeZones` does: an unreadable **or
 * malformed** file must not be read as "nothing is hidden" — either would
 * draw the line a corrupt file was supposed to be cutting out of. Missing is
 * the normal case (most trips have no edits) and reads as empty. Every row
 * is validated on the way out, not only on the way in through `writeTrackEdits`
 * — a file edited by hand, or written by an older or newer version of this
 * shape, gets the same refusal a garbled one does, since either way this
 * function cannot vouch for what it would otherwise hand back. */
export function readTrackEdits(username: string, tripId: string): TrackEdits {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(editsFile(username, tripId), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_EDITS;
    return badFile(username, tripId);
  }
  if (typeof raw !== "object" || raw === null) return badFile(username, tripId);
  const doc = raw as Partial<TrackEdits>;
  const hiddenSpots = doc.hiddenSpots ?? [];
  const hiddenStretches = doc.hiddenStretches ?? [];
  const namedStretches = doc.namedStretches ?? [];
  if (
    !Array.isArray(hiddenSpots) ||
    !Array.isArray(hiddenStretches) ||
    !Array.isArray(namedStretches) ||
    !hiddenSpots.every(validSpot) ||
    !hiddenStretches.every(validStretchShape) ||
    !namedStretches.every(validNamedStretch)
  ) {
    return badFile(username, tripId);
  }
  const ids = [...hiddenSpots, ...hiddenStretches, ...namedStretches].map((e) => e.id);
  if (new Set(ids).size !== ids.length) return badFile(username, tripId);
  return { hiddenSpots, hiddenStretches, namedStretches };
}

/** Written whole and renamed, the same as `./enrich.ts`'s own
 * `writeFileAtomic` — a reader must never see a half-written file. The
 * `.tmp` this creates in passing is excluded from export and sync the same
 * way the finished file is (`lib/exportZip.ts`, `lib/sync/manifest.ts`). */
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
 * spot to every other trip too. Takes a bare coordinate as well as a `Fix`
 * (`t` is never read) — `readerTrack`'s own serve-time fallback
 * (`./track.ts`) has only a stored `[lat, lon]`, never a fix. */
export function isInHiddenSpot(point: { lat: number; lon: number }, spots: HiddenSpot[]): boolean {
  return spots.some((spot) => metresBetween(point, { lat: spot.lat, lon: spot.lon }) <= spot.radiusM);
}

/** A stretch resolved to an absolute range — what `deriveTrack` (`./enrich.ts`)
 * actually tests a fix's instant against, never the wall clock stored on
 * disk. Built by `resolvedHiddenStretches`/`resolvedNamedStretches`
 * (`./api.ts`), the one place that has both a stretch's own `date` and that
 * date's own day `timezone` to resolve it with. */
export type ResolvedRange = { from: string; to: string };

/** Whether an instant falls inside any hidden (or named — see the doc
 * comment on `deriveTrack`) stretch, once resolved to an absolute range.
 * Both share this check: naming a stretch says something about it, it does
 * not change whether it is hidden — only `hiddenStretches` does that. */
export function isInStretch(t: number, stretches: ResolvedRange[]): boolean {
  return stretches.some((s) => {
    const from = Date.parse(s.from);
    const to = Date.parse(s.to);
    return t >= from && t <= to;
  });
}

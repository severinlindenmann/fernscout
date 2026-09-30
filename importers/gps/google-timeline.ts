import { isSaneFix, parseGeoUri, parseInstant, type Fix, type GpsImporter, type TransportMode } from "./schema";

/**
 * Google Maps Timeline, as exported from the phone.
 *
 * Settings → Location → Timeline → Export Timeline data. A flat array of
 * segments — this is not the old Takeout shape (see google-records.ts) — each
 * with `startTime`, `endTime` and exactly one of:
 *
 * | `timelinePath` | the line itself: points as a coordinate pair with a minute offset from `startTime` |
 * | `activity`     | a leg: a start and an end coordinate, and Google's guess at the mode |
 * | `visit`        | a stay: one place, over a span |
 *
 * All three are read. The path is the bulk of it — a real export ran about
 * fifty points a day, a minute apart while moving — and the other two are what
 * keeps the line joined across the hours the path does not cover.
 *
 * Google's guessed mode (`in train`, `cycling`) is a guess about what
 * happened — the one thing this software does not invent on its own — but
 * since B2541 (owner decision S2 B) it is kept anyway, mapped to the one
 * shared vocabulary (`TRANSPORT_MODES`), because a guess the owner can see
 * and override (a named stretch, B2539) beats no information at all: the
 * Algarve find that started this ticket was a dolphin boat trip Google
 * called "in passenger vehicle, 43 km", and naming the stretch is the actual
 * fix — trusting the guess never was. A type this map does not recognise is
 * left with no mode at all, never guessed at.
 *
 * Android and iOS write this file differently since Google moved Timeline
 * onto the phone in 2024 — B1819. Both wrap the same segment shape above, but
 * iOS writes a coordinate as `geo:lat,lng` where Android writes the bare pair
 * with degree signs (`parseGeoUri` in `./schema` reads both), and iOS's
 * `visit.topCandidate.placeLocation` is that string directly where Android
 * nests it one level down, under `latLng`.
 */
/** Google's own activity-type strings, lowercased, mapped to
 * `TRANSPORT_MODES` — B2541. Only the types actually seen in an export are
 * named; anything else comes back `undefined` rather than a guess. */
// A `Map`, not a plain object — a crafted export with `"type": "__proto__"`
// or `"constructor"` against a plain `{}` lookup table returns the object's
// own prototype or constructor rather than `undefined`, which is exactly
// the kind of thing `isSaneFix`'s "is this actually on Earth" check does not
// exist to catch (security review, 2026-09-28). A `Map` has no prototype
// chain to shadow a key with.
const GOOGLE_MODES = new Map<string, TransportMode>([
  ["walking", "on_foot"],
  ["on foot", "on_foot"],
  ["running", "on_foot"],
  ["cycling", "bike"],
  ["in passenger vehicle", "car"],
  ["in vehicle", "car"],
  ["driving", "car"],
  ["in bus", "bus"],
  ["in train", "train"],
  ["in tram", "tram"],
  ["in subway", "train"],
  ["in ferry", "boat"],
  ["boating", "boat"],
  ["sailing", "boat"],
  ["flying", "plane"],
  ["skiing", "skiing"],
]);

function modeFromGoogle(type: unknown): TransportMode | undefined {
  if (typeof type !== "string") return undefined;
  return GOOGLE_MODES.get(type.toLowerCase());
}

/**
 * How close a synthesized `activity`/`visit` instant may be to a real
 * `timelinePath` fix elsewhere in the export before it is dropped as
 * redundant — B2571.
 *
 * A phone's Timeline export carries two independent streams for the same
 * stretch of time: dense, per-minute `timelinePath` points, and coarser
 * `activity`/`visit` segments describing Google's own interpretation of what
 * happened. The owner's own export showed these do not agree at a segment's
 * own boundary — an `activity` 67 minutes long, ending 50 km from where it
 * started, whose own `start` coordinate sat 34 km into the drive rather than
 * at the driveway the `timelinePath` (and the `visit` right before it) both
 * agree the drive left from a few seconds earlier. Trusting `activity.start`
 * literally at `startTime` stores a point from later in the drive at the
 * drive's own start time — the out-and-back this ticket is named for.
 * Three minutes covers a `timelinePath`'s own usual one-point-a-minute
 * spacing with room to spare, without silently discarding an `activity`
 * that genuinely bridges an hours-long stretch the path does not cover —
 * exactly the case its own module doc above describes it for.
 */
const PATH_OVERRIDE_MS = 3 * 60_000;

/** Whether a real `timelinePath` fix exists within `PATH_OVERRIDE_MS` of `t`
 * — binary search, since a real export's path times run into the tens of
 * thousands and this is asked once per `activity`/`visit` boundary. */
function nearPathFix(t: number, sortedPathTimes: readonly number[]): boolean {
  let lo = 0;
  let hi = sortedPathTimes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sortedPathTimes[mid];
    if (Math.abs(v - t) <= PATH_OVERRIDE_MS) return true;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Every real `timelinePath` instant across the whole export, sorted — B2571.
 * `activity`/`visit` segments are checked against this before their own
 * coarse start/end/stay location is trusted as a fix at that exact instant. */
function pathTimesFrom(segments: unknown[]): number[] {
  const times: number[] = [];
  for (const segment of segments) {
    if (typeof segment !== "object" || segment === null) continue;
    const row = segment as Record<string, unknown>;
    const start = parseInstant(row.startTime);
    const path = row.timelinePath;
    if (start === undefined || !Array.isArray(path)) continue;
    for (const step of path) {
      if (typeof step !== "object" || step === null) continue;
      const offset = Number((step as Record<string, unknown>).durationMinutesOffsetFromStartTime ?? 0);
      times.push(start + (Number.isFinite(offset) ? offset : 0) * 60_000);
    }
  }
  return times.sort((a, b) => a - b);
}

function fixesFrom(segment: Record<string, unknown>, sortedPathTimes: readonly number[]): Fix[] {
  const start = parseInstant(segment.startTime);
  const end = parseInstant(segment.endTime);
  if (start === undefined) return [];
  const out: Fix[] = [];

  const path = segment.timelinePath;
  if (Array.isArray(path)) {
    for (const step of path) {
      if (typeof step !== "object" || step === null) continue;
      const row = step as Record<string, unknown>;
      const point = parseGeoUri(row.point);
      if (!point) continue;
      const offset = Number(row.durationMinutesOffsetFromStartTime ?? 0);
      out.push({ t: start + (Number.isFinite(offset) ? offset : 0) * 60_000, ...point });
    }
  }

  const activity = segment.activity;
  if (typeof activity === "object" && activity !== null) {
    const leg = activity as Record<string, unknown>;
    const from = parseGeoUri(leg.start);
    const to = parseGeoUri(leg.end);
    const candidate = leg.topCandidate;
    const mode = modeFromGoogle(
      typeof candidate === "object" && candidate !== null
        ? (candidate as Record<string, unknown>).type
        : undefined,
    );
    // A real path fix already this close to the boundary instant is the
    // denser, more trustworthy source — see `PATH_OVERRIDE_MS` above.
    if (from && !nearPathFix(start, sortedPathTimes)) out.push({ t: start, ...from, ...(mode ? { mode } : {}) });
    if (to && end !== undefined && !nearPathFix(end, sortedPathTimes))
      out.push({ t: end, ...to, ...(mode ? { mode } : {}) });
  }

  const visit = segment.visit;
  if (typeof visit === "object" && visit !== null) {
    const candidate = (visit as Record<string, unknown>).topCandidate;
    if (typeof candidate === "object" && candidate !== null) {
      const location = (candidate as Record<string, unknown>).placeLocation;
      // iOS gives `placeLocation` as the `geo:` string directly. Android
      // nests the same pair one level down, under `latLng` — B1819.
      const at = parseGeoUri(
        typeof location === "object" && location !== null
          ? (location as Record<string, unknown>).latLng
          : location,
      );
      if (at && !nearPathFix(start, sortedPathTimes)) out.push({ t: start, ...at });
    }
  }

  return out;
}

const importer: GpsImporter = {
  id: "google-timeline",
  label: "Google Maps Timeline (phone export)",

  detect(head, filename) {
    if (!/\.json$/i.test(filename)) return false;
    return (
      head.includes("timelinePath") ||
      head.includes("semanticSegments") ||
      (head.includes('"geo:') && head.includes("startTime"))
    );
  },

  parse(text) {
    const parsed: unknown = JSON.parse(text);
    // Two wrappers seen in the wild: the bare array the phone writes, and an
    // object keyed `semanticSegments` (or, older, `timelineObjects`).
    const segments = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? ((parsed as Record<string, unknown>).semanticSegments ??
          (parsed as Record<string, unknown>).timelineObjects)
        : undefined;
    if (!Array.isArray(segments)) throw new Error("not a Timeline export");

    const pathTimes = pathTimesFrom(segments);
    const out: Fix[] = [];
    for (const segment of segments) {
      if (typeof segment !== "object" || segment === null) continue;
      for (const fix of fixesFrom(segment as Record<string, unknown>, pathTimes))
        if (isSaneFix(fix)) out.push(fix);
    }
    return out;
  },
};

export default importer;

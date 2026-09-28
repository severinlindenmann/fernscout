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
function modeFromGoogle(type: unknown): TransportMode | undefined {
  if (typeof type !== "string") return undefined;
  const known: Record<string, TransportMode> = {
    walking: "on_foot",
    "on foot": "on_foot",
    running: "on_foot",
    cycling: "bike",
    "in passenger vehicle": "car",
    "in vehicle": "car",
    driving: "car",
    "in bus": "bus",
    "in train": "train",
    "in tram": "tram",
    "in subway": "train",
    "in ferry": "boat",
    boating: "boat",
    sailing: "boat",
    flying: "plane",
    skiing: "skiing",
  };
  return known[type.toLowerCase()];
}

function fixesFrom(segment: Record<string, unknown>): Fix[] {
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
    if (from) out.push({ t: start, ...from, ...(mode ? { mode } : {}) });
    if (to && end !== undefined) out.push({ t: end, ...to, ...(mode ? { mode } : {}) });
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
      if (at) out.push({ t: start, ...at });
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

    const out: Fix[] = [];
    for (const segment of segments) {
      if (typeof segment !== "object" || segment === null) continue;
      for (const fix of fixesFrom(segment as Record<string, unknown>))
        if (isSaneFix(fix)) out.push(fix);
    }
    return out;
  },
};

export default importer;

import { isSaneFix, parseGeoUri, parseInstant, type Fix, type Importer } from "./types";

/**
 * Google Maps Timeline, as exported from the phone.
 *
 * Settings → Location → Timeline → Export Timeline data. A flat array of
 * segments — this is not the old Takeout shape (see google-records.ts) — each
 * with `startTime`, `endTime` and exactly one of:
 *
 * | `timelinePath` | the line itself: points as `geo:lat,lng` with a minute offset from `startTime` |
 * | `activity`     | a leg: a start and an end coordinate, and Google's guess at the mode |
 * | `visit`        | a stay: one place, over a span |
 *
 * All three are read. The path is the bulk of it — a real export ran about
 * fifty points a day, a minute apart while moving — and the other two are what
 * keeps the line joined across the hours the path does not cover.
 *
 * Google's guessed mode (`in train`, `cycling`) is deliberately dropped. It is
 * a guess about what happened, and what happened is the one thing this
 * software does not invent.
 */
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
    if (from) out.push({ t: start, ...from });
    if (to && end !== undefined) out.push({ t: end, ...to });
  }

  const visit = segment.visit;
  if (typeof visit === "object" && visit !== null) {
    const candidate = (visit as Record<string, unknown>).topCandidate;
    const at =
      typeof candidate === "object" && candidate !== null
        ? parseGeoUri((candidate as Record<string, unknown>).placeLocation)
        : undefined;
    if (at) out.push({ t: start, ...at });
  }

  return out;
}

const importer: Importer = {
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

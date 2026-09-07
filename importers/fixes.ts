import { isSaneFix, parseInstant, type Fix, type Importer } from "./types";

/**
 * The neutral format — the door for a tool that is not written in TypeScript.
 *
 * An importer is a JavaScript module, which is fine for anybody already in
 * this repository and no use at all to somebody with forty lines of Python
 * that already reads their watch. So: have that script print this, and no
 * importer needs writing.
 *
 * One fix per line — JSON Lines, so a decade streams rather than loading —
 * in either shape:
 *
 *     [1762410000, 47.38564, 8.21819]
 *     {"t": "2025-11-06T05:00:00Z", "lat": 47.38564, "lon": 8.21819}
 *
 * `t` may be an ISO instant, epoch seconds, or epoch milliseconds; anything
 * past the year 5138 is read as milliseconds, which is the whole heuristic and
 * is unambiguous for any date a person has been anywhere. A plain JSON array
 * of either shape is accepted too, because that is what somebody's first
 * attempt will produce.
 */
const SECONDS_CEILING = 100_000_000_000;

function toFix(row: unknown): Fix | undefined {
  if (Array.isArray(row)) {
    const [t, lat, lon] = row;
    return { t: toMillis(t), lat: Number(lat), lon: Number(lon) };
  }
  if (typeof row === "object" && row !== null) {
    const r = row as Record<string, unknown>;
    const lat = r.lat ?? r.latitude;
    const lon = r.lon ?? r.lng ?? r.longitude;
    const t = r.t ?? r.time ?? r.timestamp;
    if (lat === undefined || lon === undefined || t === undefined) return undefined;
    return { t: toMillis(t), lat: Number(lat), lon: Number(lon) };
  }
  return undefined;
}

function toMillis(value: unknown): number {
  if (typeof value === "number")
    return value < SECONDS_CEILING ? value * 1000 : value;
  const parsed = parseInstant(value);
  if (parsed !== undefined) return parsed;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric < SECONDS_CEILING
      ? numeric * 1000
      : numeric
    : NaN;
}

const importer: Importer = {
  id: "fixes",
  label: "Plain fixes (JSON Lines: [t, lat, lon])",

  detect(head, filename) {
    if (/\.(jsonl|ndjson)$/i.test(filename)) return true;
    const first = head.trimStart().split("\n")[0]?.trim() ?? "";
    return /^\[\s*-?[\d.]+\s*,/.test(first) || /^\{\s*"(t|time|timestamp)"/.test(first);
  },

  parse(text) {
    const trimmed = text.trim();
    // Try the file as one JSON document first, and fall back to line by line.
    // The other way round does not work: a JSON Lines file *starts* with a
    // valid array — its first line — so testing the first character sends
    // every real one down the whole-document path and throws on line two.
    let rows: unknown[] | undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      // `[1762410000, 47.4, 8.2]` is itself a valid array, so a document of
      // nothing but numbers is one fix rather than a list of them.
      if (Array.isArray(parsed))
        rows = parsed.every((v) => typeof v === "number") ? [parsed] : parsed;
      else rows = [parsed];
    } catch {
      rows = trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return undefined;
          }
        });
    }

    const out: Fix[] = [];
    for (const row of rows) {
      if (row === undefined) continue;
      const fix = toFix(row);
      if (fix && isSaneFix(fix)) out.push(fix);
    }
    return out;
  },
};

export default importer;

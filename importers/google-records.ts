import { isSaneFix, type Fix, type Importer } from "./types";

/**
 * Google Takeout's `Records.json` — the old, account-side location history.
 *
 * One long `locations` array of raw fixes, coordinates as integer degrees
 * times 10⁷. Superseded by the on-device export (google-timeline.ts), but it
 * is what anybody who took a Takeout before 2024 has, and it is the denser of
 * the two.
 *
 * `accuracy` is metres of claimed radius. Fixes worse than a kilometre are
 * dropped: a cell-tower fix somewhere in the middle of a city is not a place
 * anybody was, and drawn as a line it invents a detour.
 */
const WORST_ACCURACY_M = 1000;

const importer: Importer = {
  id: "google-records",
  label: "Google Takeout location history (Records.json)",

  detect(head, filename) {
    if (!/\.json$/i.test(filename)) return false;
    return head.includes("latitudeE7") || head.includes('"locations"');
  },

  parse(text) {
    const parsed: unknown = JSON.parse(text);
    const rows =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).locations
        : undefined;
    if (!Array.isArray(rows)) throw new Error("not a Records.json export");

    const out: Fix[] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const accuracy = Number(r.accuracy);
      if (Number.isFinite(accuracy) && accuracy > WORST_ACCURACY_M) continue;
      // `timestamp` is ISO in newer exports, `timestampMs` a string of
      // milliseconds in older ones.
      const t =
        typeof r.timestamp === "string" ? Date.parse(r.timestamp) : Number(r.timestampMs);
      const fix: Fix = {
        t,
        lat: Number(r.latitudeE7) / 1e7,
        lon: Number(r.longitudeE7) / 1e7,
      };
      if (isSaneFix(fix)) out.push(fix);
    }
    return out;
  },
};

export default importer;

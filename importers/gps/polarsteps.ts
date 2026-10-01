import { isSaneFix, parseInstant, type Fix, type GpsImporter } from "./schema";

/**
 * Polarsteps' own `locations.json` — `{"locations": [{lat, lon, time}, …]}`,
 * one object per trip's export folder, alongside its `trip.json`
 * (B2432/B2662). `time` is unix seconds (sometimes a float); the array
 * arrives unsorted, same as `trip.json`'s own `all_steps` — the store sorts
 * on the way in, same as every other importer here, so this one does not
 * have to.
 *
 * This is the raw GPS half of a Polarsteps import: it goes through the
 * existing `kind: "gps"` door into `content/<user>/gps/` exactly like any
 * other location history, never through the new `kind: "polarsteps"` door —
 * see `importers/README.md`'s own note on why a position is never anything
 * but a `Fix`.
 */
const importer: GpsImporter = {
  id: "polarsteps",
  label: "Polarsteps locations.json",

  detect(head, filename) {
    if (/locations\.json$/i.test(filename)) return true;
    return head.includes('"locations"') && head.includes('"lat"') && head.includes('"lon"');
  },

  parse(text) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("not JSON");
    }
    const locations =
      data && typeof data === "object" && Array.isArray((data as { locations?: unknown }).locations)
        ? (data as { locations: unknown[] }).locations
        : undefined;
    if (!locations) throw new Error("not a Polarsteps locations.json");

    const out: Fix[] = [];
    for (const row of locations) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      const t = typeof r.time === "number" ? Math.round(r.time * 1000) : parseInstant(r.time);
      if (t === undefined || !Number.isFinite(t)) continue;
      const fix: Fix = { t, lat, lon };
      if (isSaneFix(fix)) out.push(fix);
    }
    return out;
  },
};

export default importer;

/**
 * The importer contract — MIT, unlike the rest of this repository.
 *
 * An importer turns one file somebody exported from somewhere else into plain
 * position fixes. That is the whole job: no network, no disk, no journal, no
 * knowledge of what a trip is. Everything downstream — thinning, storage,
 * clipping to a trip, drawing — is Fernscout's and is deliberately not
 * describable from in here.
 *
 * The folder is MIT so that an importer for a service nobody here has heard of
 * can be written, published and copied between instances without anyone
 * reading a licence first. See README.md for how to add one.
 */

/** One position, at one instant. The only currency this folder deals in. */
export type Fix = {
  /** Milliseconds since the epoch, UTC. */
  t: number;
  lat: number;
  lon: number;
};

export type Importer = {
  /** Stable, lowercase, dashes — it is written into a trip's `track.json` as
   * the credit for where the line came from. */
  id: string;
  /** What a person calls this export, for the CLI's listing. */
  label: string;
  /**
   * Does this file look like yours?
   *
   * Given the first 64 kB and the file's name. Be strict: a loose `detect`
   * that answers yes to somebody else's export is worse than one that
   * answers no to its own, because `--format <id>` is always available and a
   * wrong parse is silent.
   */
  detect(head: string, filename: string): boolean;
  /**
   * Every fix in the file, in any order — the caller sorts, de-duplicates and
   * thins.
   *
   * Skip what does not parse rather than throwing: these exports are large,
   * changed by their vendors without notice, and one unreadable segment must
   * not cost the other ten months. Throw only when the file is not yours at
   * all.
   *
   * ponytail: takes the whole file as a string, so an export much past a
   * gigabyte will not fit. Make it an async iterable if anyone ever brings
   * one.
   */
  parse(text: string): Fix[];
};

/** A fix that is actually on Earth, and not the 0,0 a broken export emits. */
export function isSaneFix(fix: Fix): boolean {
  return (
    Number.isFinite(fix.t) &&
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    fix.lat >= -90 &&
    fix.lat <= 90 &&
    fix.lon >= -180 &&
    fix.lon <= 180 &&
    !(fix.lat === 0 && fix.lon === 0)
  );
}

/** `"geo:47.38,8.21"` → a pair. Google writes coordinates this way in three
 * different places, so it is here rather than in one parser. */
export function parseGeoUri(value: unknown): { lat: number; lon: number } | undefined {
  if (typeof value !== "string" || !value.startsWith("geo:")) return undefined;
  const [lat, lon] = value.slice(4).split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon };
}

/** An ISO instant to epoch ms, or undefined. Offsets and `Z` both. */
export function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

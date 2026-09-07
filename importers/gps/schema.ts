/**
 * Positions — the row type for every importer in this folder.
 *
 * The generic shape is one level up in `../types.ts`; what is here is only
 * what a *position* importer needs. Everything downstream — thinning, storage,
 * clipping to a trip, drawing — is Fernscout's and is deliberately not
 * describable from in here.
 *
 * Everything an importer in this folder reads is somebody's complete location
 * history: every address they sleep at, every place they work, everywhere they
 * have been ill. Fernscout keeps it out of reach — the store it lands in is
 * served by no route and is in no export, and what the site draws is a
 * separate derived file clipped to one trip. An importer is not where that is
 * enforced, but it is where it starts. Take what the file says and nothing
 * more.
 */
import type { Importer } from "../schema";

export { parseInstant } from "../schema";

/** One position, at one instant. The only currency this folder deals in. */
export type Fix = {
  /** Milliseconds since the epoch, UTC. */
  t: number;
  lat: number;
  lon: number;
};

export type GpsImporter = Importer<Fix>;

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

/**
 * **Run this against your own importer.** Bring the shape above, call this,
 * fix what it lists — that is the whole of writing one.
 *
 * It is what `npm run gps -- import … --dry-run` runs, so the command is the
 * same check without an import statement. Every complaint here is a mistake
 * somebody has actually made:
 *
 * - a coordinate pair the wrong way round — Zurich at `8.2, 47.4` is in the
 *   Gulf of Guinea, and the store will happily hold it
 * - seconds where milliseconds were asked for, which puts a 2026 trip in 1970
 * - `0, 0`, which is what a broken export writes for "no idea"
 * - an `id` that will not survive being typed after `--format`
 *
 * It never touches the disk and never talks to anything. Give it the rows your
 * `parse` returned.
 */
export function checkGpsImporter(importer: GpsImporter, fixes: Fix[]): string[] {
  const problems: string[] = [];
  const say = (problem: string) => problems.push(problem);

  if (!/^[a-z0-9-]+$/.test(importer.id))
    say(`id ${JSON.stringify(importer.id)} must be lowercase letters, digits and dashes`);
  if (!importer.label) say("label is empty — it is what the CLI lists");

  if (fixes.length === 0) {
    say("parse returned nothing: the wrong importer, or an export with no positions");
    return problems;
  }

  const insane = fixes.filter((fix) => !isSaneFix(fix));
  if (insane.length > 0)
    say(
      `${insane.length} of ${fixes.length} fixes are not on Earth — ` +
        `first: ${JSON.stringify(insane[0])}. Latitude is ±90 and longitude ±180; ` +
        `a pair the wrong way round is the usual cause`,
    );

  // 2001 to 2100, which is every date a person has travelled and will.
  const out = fixes.filter((fix) => fix.t < 978_307_200_000 || fix.t > 4_102_444_800_000);
  if (out.length > 0)
    say(
      `${out.length} fixes are outside 2001–2100 — first: ${new Date(out[0].t).toISOString()}. ` +
        `t is milliseconds since the epoch; seconds land in 1970`,
    );

  return problems;
}

/**
 * Fills a day's `region` (canton, Land, state, regione — B2640) from the
 * day's own stored place, for days a day already carries but never asks the
 * GPS store for.
 *
 *   npx tsx --conditions=react-server scripts/backfill-day-regions.mts --user alex
 *   npx tsx --conditions=react-server scripts/backfill-day-regions.mts --user alex --write
 *
 * Dry-run by default — prints what each day would get and changes nothing.
 * `--write` applies it. `--trip <id>` narrows to one trip.
 *
 * Reads only what a day already has on disk: `coordinates` (preferred — the
 * same reverse-geocode `reversePlace` already does for a day created with
 * a position) or, failing that, `location`/`country` as free text fed to the
 * forward geocoder (`geocodePlace`), hinted with the day's own country so a
 * "Luzern" in Switzerland is not confused with one somewhere else. **Never
 * `content/<user>/gps/`** — that store is read by exactly two doors
 * (`lib/gps/api.ts`), and a backfill script is not one of them; a day with
 * neither a position nor a place name is left alone, the same as a day that
 * already has a region or named none of this in the first place.
 *
 * Rate-limited to one lookup per second — polite to the public Photon
 * instance most self-hosted journals still point at, and the only way a
 * dry run over a real multi-year journal does not look like abuse.
 */
import { loadUserConfig } from "../lib/config.ts";
import { geocodePlace, reversePlace } from "../lib/addressLookup.ts";
import { listDaySlugs, listTripIds, readDayFile, writeDayFile } from "../lib/api/v2/store.ts";

const RATE_LIMIT_MS = 1100;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`--${name} <value> is required`);
    process.exit(1);
  }
  return value;
}

const user = required("user");
const onlyTrip = arg("trip");
const write = process.argv.includes("--write");
const locale = loadUserConfig(user).defaultLocale ?? "en";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const trips = onlyTrip ? [onlyTrip] : listTripIds(user);

let filled = 0;
let skippedHasRegion = 0;
let skippedNoPlace = 0;
let noAnswer = 0;

for (const tripId of trips) {
  for (const slug of listDaySlugs(user, tripId)) {
    const day = readDayFile(user, tripId, slug);
    if (!day) continue;
    if (day.region) {
      skippedHasRegion++;
      continue;
    }

    let region: string | undefined;
    if (day.coordinates) {
      await sleep(RATE_LIMIT_MS);
      const place = await reversePlace(day.coordinates.lat, day.coordinates.lng, locale).catch(() => null);
      region = place?.region;
    } else if (day.location || day.country) {
      await sleep(RATE_LIMIT_MS);
      const candidates = await geocodePlace(day.location ?? day.country ?? "", locale, {
        countryHint: day.country,
      }).catch(() => null);
      region = candidates?.[0]?.adminRegion;
    } else {
      skippedNoPlace++;
      continue;
    }

    if (!region) {
      noAnswer++;
      console.log(`  ${tripId}/${slug}: no region found (${day.location ?? day.country ?? "coordinates only"})`);
      continue;
    }

    console.log(`  ${tripId}/${slug}: ${day.location ?? day.country ?? "?"} → ${region}`);
    filled++;
    if (write) writeDayFile(user, tripId, slug, { ...day, region });
  }
}

console.log(
  `\n${write ? "wrote" : "would write"} ${filled} region${filled === 1 ? "" : "s"}, ` +
    `${skippedHasRegion} already had one, ${skippedNoPlace} named no place at all, ${noAnswer} found none.`,
);
if (!write && filled > 0) console.log("Dry run — rerun with --write to apply.");

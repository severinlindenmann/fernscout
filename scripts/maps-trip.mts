/**
 * `npm run maps:trip -- <user> <trip>` — B2535. Extracts one PMTiles file
 * per region of this trip's day places (a region is what
 * `docs/plans/2026-09-28-trip-maps/README.md` calls it: places within 300 km
 * of each other, transitively) to z15, padded ~15 km, and records each in
 * `MAPS_DIR/index.json` — the file `lib/maps/dir.ts`'s `tripMapRegions`
 * reads to tell `components/map/StreetMap.tsx` which file(s) cover a trip.
 *
 * `npm run maps:trip -- …`, not `tsx scripts/maps-trip.mts …` directly —
 * see scripts/export.mts's doc comment for why.
 */
import fs from "node:fs";
import path from "node:path";
import { AS_AUTHOR, getPlaces } from "../lib/entries";
import { isPlottable } from "../lib/mapFrame";
import { getTrip, tripRef } from "../lib/trips";
import { clusterRegions, mapsSource, paddedBbox, requirePmtilesBinary, runPmtilesExtract } from "./maps-lib";
import type { MapRegion } from "../lib/maps/dir";

/** ~15 km padding, per the plan. */
const PAD_KM = 15;
/** Regions further apart than this stay separate files. */
const REGION_THRESHOLD_KM = 300;

type Index = { trips: Record<string, MapRegion[]> };

function readIndex(file: string): Index {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && raw.trips) return raw as Index;
  } catch {
    // No index yet — starts empty.
  }
  return { trips: {} };
}

function main() {
  const [user, trip] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!user || !trip) {
    console.error("Usage: npm run maps:trip -- <user> <trip>");
    process.exit(1);
  }

  const dir = process.env.MAPS_DIR?.trim();
  if (!dir) {
    console.error("MAPS_DIR is not set. Point it at the folder your operator serves tiles from, then re-run.");
    process.exit(1);
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    console.error(`No such trip: ${ref}`);
    process.exit(1);
  }

  const places = getPlaces(ref, AS_AUTHOR).filter(isPlottable);
  if (places.length === 0) {
    console.error(`${ref} has no places with coordinates yet — nothing to extract.`);
    return;
  }

  requirePmtilesBinary();
  fs.mkdirSync(dir, { recursive: true });
  const source = mapsSource();

  const regionGroups = clusterRegions(places, REGION_THRESHOLD_KM);
  const slug = `${user}-${trip}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const regions: MapRegion[] = regionGroups.map((group, i) => {
    const bbox = paddedBbox(group, PAD_KM);
    const relFile = regionGroups.length > 1 ? `trips/${slug}-${i + 1}.pmtiles` : `trips/${slug}.pmtiles`;
    const out = path.join(dir, relFile);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    console.error(`Extracting ${ref} region ${i + 1}/${regionGroups.length} (bbox ${bbox.join(",")}) …`);
    runPmtilesExtract([source, out, `--bbox=${bbox.join(",")}`, "--maxzoom=15"]);
    return { file: relFile, bbox };
  });

  const indexFile = path.join(dir, "index.json");
  const index = readIndex(indexFile);
  index.trips[ref] = regions;
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
  console.error(`Done. ${ref} now has ${regions.length} region file(s) in ${indexFile}.`);
}

main();

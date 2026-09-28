/**
 * `npm run maps:world` — B2535. Extracts a low-zoom (z0–6) world file from
 * the configured Protomaps source into `MAPS_DIR/world.pmtiles`, the one
 * file `features.streetMaps` requires to be readable before it can be on
 * (lib/capabilities.ts). Run once per operator, re-run whenever `MAPS_SOURCE`
 * moves to a newer build.
 *
 * `npm run maps:world`, not `tsx scripts/maps-world.mts` directly — see the
 * doc comment in scripts/export.mts for why (the `react-server` export
 * condition this needs comes from the npm script).
 */
import fs from "node:fs";
import path from "node:path";
import { mapsSource, requirePmtilesBinary, runPmtilesExtract } from "./maps-lib.mts";

function main() {
  const dir = process.env.MAPS_DIR?.trim();
  if (!dir) {
    console.error("MAPS_DIR is not set. Point it at the folder your operator serves tiles from, then re-run.");
    process.exit(1);
  }
  requirePmtilesBinary();
  fs.mkdirSync(dir, { recursive: true });
  const source = mapsSource();
  const out = path.join(dir, "world.pmtiles");
  console.error(`Extracting z0–6 world from ${source} to ${out} …`);
  runPmtilesExtract([source, out, "--maxzoom=6"]);
  console.error(`Done. features.streetMaps can now be enabled once MAPS_DIR is set on the server.`);
}

main();

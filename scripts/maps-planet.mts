/**
 * `npm run maps:planet` — B2566. Downloads the whole Protomaps build (z0–15,
 * about 120 GB) from `MAPS_SOURCE` into `MAPS_DIR/planet.pmtiles`: one
 * street-level file for every place, so no trip waits for `maps:trip`.
 *
 * A plain download, resumable, rather than `pmtiles extract --maxzoom=14`:
 * that extract is one long stream that cannot resume, and the first attempt
 * on fernscout.ch died 5 GB in (2026-09-30). `aria2c` (16 connections) when
 * it is on PATH, else `curl -C -`; either picks up where a broken run left
 * off. Written to `planet.pmtiles.download`, checked with `pmtiles show`,
 * then renamed over the old file — the site serves the old one until then.
 *
 * Needs about the file's size free again while it downloads. A small
 * self-hosted instance does not need this at all: `maps:trip` cuts just a
 * trip's own regions.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mapsSource, requirePmtilesBinary } from "./maps-lib.mts";

function onPath(bin: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
}

function main() {
  const dir = process.env.MAPS_DIR?.trim();
  if (!dir) {
    console.error("MAPS_DIR is not set. Point it at the folder your operator serves tiles from, then re-run.");
    process.exit(1);
  }
  requirePmtilesBinary();
  const source = mapsSource();
  const part = path.join(dir, "planet.pmtiles.download");
  const out = path.join(dir, "planet.pmtiles");
  console.error(`Downloading ${source} to ${part} …`);
  if (onPath("aria2c")) {
    execFileSync("aria2c", ["-c", "-x16", "-s16", "-k16M", "--max-tries=0", "--retry-wait=5",
      "--console-log-level=warn", "--summary-interval=300", "-d", dir, "-o", path.basename(part), source], { stdio: "inherit" });
  } else {
    execFileSync("curl", ["-fL", "--retry", "50", "--retry-all-errors", "--retry-delay", "5", "-C", "-", "-o", part, source], { stdio: "inherit" });
  }
  // A truncated or wrong file fails here, before it replaces anything.
  execFileSync("pmtiles", ["show", part], { stdio: ["ignore", "ignore", "inherit"] });
  fs.renameSync(part, out);
  console.error(`Done: ${out}. Every map without a trip region now draws streets from it.`);
}

main();

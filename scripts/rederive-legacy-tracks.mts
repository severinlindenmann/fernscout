/**
 * B2202 deploy step — re-derive every `track.json` written before this
 * ticket's rework.
 *
 * A legacy file has no `day` on any segment (`TrackSegment.day` did not
 * exist yet), and `readerTrack` (`lib/gps/track.ts`) drops every segment
 * without one, so a legacy trip's line is invisible to readers until it is
 * re-derived once. That is the safe default — an un-migrated file simply
 * stops being drawn rather than leaking a stale, unclipped line — but a
 * trip an owner actually wants readers to see needs this run once, after
 * deploy.
 *
 *   npx tsx --conditions=react-server scripts/rederive-legacy-tracks.mts [--dry-run]
 *
 * Finds every trip that both has a `track.json` on disk and whose owner has
 * some GPS history to derive from (no history ⇒ nothing to re-derive;
 * `deriveTripTrack` would only delete the file), and calls the same
 * `deriveTripTrack` a publish or an import already calls. Idempotent: running
 * it twice re-derives the same trips the same way.
 */
import fs from "node:fs";
import { deriveTripTrack } from "../lib/gps/api.ts";
import { gpsDir } from "../lib/gps/store.ts";
import { trackFile } from "../lib/gps/track.ts";
import { getTrips } from "../lib/trips.ts";
import { getUsernames } from "../lib/users.ts";

const dry = process.argv.includes("--dry-run");

function hasGpsHistory(username: string): boolean {
  try {
    return fs.readdirSync(gpsDir(username)).some((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

let checked = 0;
let rederived = 0;
let deleted = 0;
let skipped = 0;

for (const username of getUsernames()) {
  if (!hasGpsHistory(username)) continue;
  for (const trip of getTrips(username)) {
    if (!fs.existsSync(trackFile(username, trip.id))) continue;
    checked++;
    const label = `${username}/${trip.id}`;
    if (dry) {
      console.log(`[dry-run] would re-derive ${label}`);
      continue;
    }
    const result = deriveTripTrack(username, { id: trip.id, start: trip.start, end: trip.end });
    if (result.written) {
      console.log(`${label}: re-derived — ${result.segments} segment(s), ${result.points} point(s).`);
      rederived++;
    } else {
      console.log(`${label}: nothing left to draw — track.json removed.`);
      deleted++;
    }
  }
}

if (checked === 0) {
  console.log("Nothing to do: no trip has both a track.json and an owner with GPS history.");
} else {
  console.log(
    `\nSummary: ${checked} legacy track(s) found, ${rederived} re-derived, ${deleted} removed (nothing left to draw)` +
      (dry ? ", 0 changed (--dry-run)." : "."),
  );
  if (dry) {
    skipped = checked;
    console.log(`Re-run without --dry-run to apply. (${skipped} would be touched.)`);
  }
}

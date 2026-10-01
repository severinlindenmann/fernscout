/**
 * The whole synthetic export, as bytes — the ZIP a browser would actually
 * drop onto B2662's studio screen. Built with `archiver` (test-only, same
 * as `lib/exportZip.ts` uses for a real export) rather than a fixture
 * checked into the repo, so nothing here is a copy of anybody's real
 * `user_data.zip`.
 */
import { buffer as streamToBuffer } from "node:stream/consumers";
import { ZipArchive } from "archiver";
import sharp from "sharp";
import { locationsJsonFor, mediaFor, tripA, tripB } from "./polarsteps";
import type { PolarstepsStep, PolarstepsTrip } from "@/importers/trips/polarsteps";

async function tinyJpeg(seed: number): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: seed % 255, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

/** Not a playable video — nobody here decodes it — just a non-empty byte
 * string with the right extension, the shape `mediaFor`'s "one video"
 * quirk needs to exist as a real zip entry. */
const FAKE_VIDEO = Buffer.from("not a real mp4, just bytes for the zip entry\0".repeat(20));

function tripFolderName(trip: PolarstepsTrip): string {
  return `${trip.slug}_${trip.id}`;
}

function stepFolderName(step: PolarstepsStep): string {
  return `${step.display_slug}_${step.id}`;
}

async function addTrip(archive: ZipArchive, trip: PolarstepsTrip, locations: "a" | "b"): Promise<void> {
  const folder = `trip/${tripFolderName(trip)}`;
  archive.append(Buffer.from(JSON.stringify(trip, null, 2)), { name: `${folder}/trip.json` });
  archive.append(Buffer.from(locationsJsonFor(locations)), { name: `${folder}/locations.json` });

  let seed = trip.id;
  for (const step of trip.all_steps) {
    const media = mediaFor(step);
    const stepDir = `${folder}/${stepFolderName(step)}`;
    for (const name of media.photos) {
      archive.append(await tinyJpeg(seed++), { name: `${stepDir}/photos/${name}` });
    }
    for (const name of media.videos) {
      archive.append(FAKE_VIDEO, { name: `${stepDir}/videos/${name}` });
    }
    // A step with neither list populated gets no folder at all — the
    // confirmed quirk, not an empty `photos/`.
  }
}

/** `user/user.json` — present in a real export, never imported (B2432's
 * Design section). Included so a ZIP reader that mistakenly tried to read
 * it would be caught by a test, not shipped. */
function addUser(archive: ZipArchive): void {
  archive.append(
    Buffer.from(JSON.stringify({ id: 1, first_name: "Test", locale: "en", unit_is_km: true, temperature_is_celsius: true })),
    { name: "user/user.json" },
  );
}

/** The whole `user_data.zip`, both trips, every quirk B2432/B2662 name. */
export async function buildPolarstepsExportZip(): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const bufferPromise = streamToBuffer(archive);
  addUser(archive);
  await addTrip(archive, tripA, "a");
  await addTrip(archive, tripB, "b");
  await archive.finalize();
  return bufferPromise;
}

/** A ZIP with one entry whose name escapes the folder it is in — the
 * refusal B2662's acceptance line names. */
export async function buildTraversalZip(): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const bufferPromise = streamToBuffer(archive);
  archive.append(Buffer.from("nope"), { name: "../../etc/evil.txt" });
  await archive.finalize();
  return bufferPromise;
}

/** A ZIP with one JSON entry that inflates far past any real trip.json —
 * the "extreme compression ratio" refusal, as a 1000:1 payload. */
export async function buildZipBombZip(): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const bufferPromise = streamToBuffer(archive);
  // Highly compressible: one repeated character, ~30 MB uncompressed.
  archive.append(Buffer.from("0".repeat(30 * 1024 * 1024)), { name: "trip/bomb_1/trip.json" });
  await archive.finalize();
  return bufferPromise;
}

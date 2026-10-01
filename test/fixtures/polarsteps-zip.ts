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

/**
 * A ZIP with one entry whose name escapes the folder it is in — the
 * refusal B2662's acceptance line names. `archiver` itself sanitises a
 * `../` name before it ever reaches a zip entry (confirmed: it rewrites
 * `"../../etc/evil.txt"` to `"etc/evil.txt"`), which is correct of a
 * writer but useless for testing a *reader*'s own guard against one built
 * by something less careful. So this is a hand-built, minimal, stored-only
 * ZIP — no `archiver`, no compression, no CRC checked by anything that
 * reads it — just the three records `lib/zip/readZip.ts` actually parses:
 * one local file header, one central directory entry, one
 * end-of-central-directory record.
 */
export function buildTraversalZip(): Buffer {
  const name = Buffer.from("../secret.txt", "utf8");
  const data = Buffer.from("nope");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // compression: stored
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0, 12); // date
  local.writeUInt32LE(0, 14); // crc32 — unchecked by this reader
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const localRecord = Buffer.concat([local, name, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8); // flags
  central.writeUInt16LE(0, 10); // compression: stored
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16); // crc32
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra length
  central.writeUInt16LE(0, 32); // comment length
  central.writeUInt16LE(0, 34); // disk number
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // local header offset

  const centralRecord = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16); // central directory offset
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localRecord, centralRecord, eocd]);
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

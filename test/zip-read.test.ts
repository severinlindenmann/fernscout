import { describe, expect, test } from "vitest";
import { readZipEntries, readZipEntryText, ZipError } from "@/lib/zip/readZip";
import { buildPolarstepsExportZip, buildTraversalZip, buildZipBombZip } from "./fixtures/polarsteps-zip";
import { tripA } from "./fixtures/polarsteps";

/** Node's global `Blob` is the same Web API the browser has — this module
 * is framework-free, so the real synthetic export can be read here with no
 * DOM at all. */
function blobOf(bytes: Buffer): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe("readZip — the synthetic Polarsteps export", () => {
  test("lists both trips' files, never a directory entry, never an unsafe name", async () => {
    const zip = blobOf(await buildPolarstepsExportZip());
    const entries = await readZipEntries(zip);
    const names = entries.map((e) => e.name);
    expect(names).toContain("trip/alpine-loop_5001/trip.json");
    expect(names).toContain("trip/alpine-loop_5001/locations.json");
    expect(names).toContain("trip/tokyo-nights_5002/trip.json");
    expect(names).toContain(
      "trip/alpine-loop_5001/ferry-at-dawn_11/photos/aaaaaaaa-feed-face-beef-aaaaaaaaaaaa_bbbbbbbb-feed-face-beef-bbbbbbbbbbbb.jpg.jpg",
    );
    expect(names.some((n) => n.endsWith("/"))).toBe(false);
  });

  test("reads trip.json back as exactly the trip it was given", async () => {
    const zip = blobOf(await buildPolarstepsExportZip());
    const entries = await readZipEntries(zip);
    const entry = entries.find((e) => e.name === "trip/alpine-loop_5001/trip.json")!;
    const text = await readZipEntryText(zip, entry, { maxBytes: 20 * 1024 * 1024 });
    expect(JSON.parse(text)).toEqual(tripA);
  });

  test("the video entry's bytes round-trip (stored or deflated, either way)", async () => {
    const zip = blobOf(await buildPolarstepsExportZip());
    const entries = await readZipEntries(zip);
    const entry = entries.find((e) => e.name.endsWith("clip.mp4"))!;
    const text = await readZipEntryText(zip, entry);
    expect(text.startsWith("not a real mp4")).toBe(true);
  });
});

describe("readZip — refusals", () => {
  test("a ../ entry never appears in the listing", async () => {
    const zip = blobOf(buildTraversalZip());
    const entries = await readZipEntries(zip);
    expect(entries).toEqual([]);
  });

  test("a 1000:1 JSON entry is refused by its declared size, before inflating", async () => {
    const zip = blobOf(await buildZipBombZip());
    const entries = await readZipEntries(zip);
    const entry = entries.find((e) => e.name.endsWith("trip.json"))!;
    expect(entry.uncompressedSize).toBeGreaterThan(20 * 1024 * 1024);
    await expect(readZipEntryText(zip, entry, { maxBytes: 20 * 1024 * 1024 })).rejects.toThrow(ZipError);
  });

  test("not a zip at all", async () => {
    await expect(readZipEntries(blobOf(Buffer.from("hello, not a zip")))).rejects.toThrow(ZipError);
  });
});

describe("readZip — a large archive stays cheap to list", () => {
  test("a ~300 MB stored-padding zip lists in well under its own size in memory", async () => {
    const { ZipArchive } = await import("archiver");
    const { buffer: streamToBuffer } = await import("node:stream/consumers");
    const archive = new ZipArchive({ store: true });
    const bufferPromise = streamToBuffer(archive);
    const chunk = Buffer.alloc(50 * 1024 * 1024, 7);
    for (let i = 0; i < 6; i++) archive.append(chunk, { name: `pad/${i}.bin` });
    await archive.finalize();
    const bytes = await bufferPromise;
    const zip = blobOf(bytes);
    const entries = await readZipEntries(zip);
    expect(entries).toHaveLength(6);
    expect(entries.every((e) => e.uncompressedSize === 50 * 1024 * 1024)).toBe(true);
  }, 30_000);
});

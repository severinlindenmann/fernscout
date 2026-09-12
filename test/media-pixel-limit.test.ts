import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { paintJpeg } from "./support/pictures";

/**
 * B1554 — the API upload path never populated `longestEdge`, so the
 * `imageEdge` check in `lib/validate/media.ts` was dead code on this door:
 * only `npm run ingest` ever fed it a real value. Worse, nothing capped the
 * pixels sharp would decode either, so a small file claiming an enormous
 * image paid for the full decode before anything refused it.
 *
 * `decodeSource` is spied on to prove the second half: a refused upload never
 * reaches it at all.
 */
vi.mock("@/lib/ingest/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ingest/image")>();
  return { ...actual, decodeSource: vi.fn(actual.decodeSource) };
});

const { decodeSource } = await import("@/lib/ingest/image");
const { storeUploads } = await import("@/lib/api/media");

let dir: string;
const REF = "alex/asia-2026";
const tripPath = () => path.join(dir, "alex", "trips", "asia-2026");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-pixel-limit-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
      // A narrow edge, so a photograph cheap enough to paint in a test still
      // exceeds it — the mechanism under test is the same one a real
      // instance's `imageEdge` config drives.
      media: { imageEdge: 200 },
    }),
  );
  clearConfigCache();
  clearUserCache();
  fs.writeFileSync(
    path.join(tripPath(), "entries", "2026-01-01-day-one.md"),
    [
      "---",
      'title: "day-one"',
      'date: "2026-01-01"',
      'location: "Hoi An"',
      'country: "Vietnam"',
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );
  vi.mocked(decodeSource).mockClear();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the imageEdge limit on the network path", () => {
  test("an ordinary photograph within the edge is stored", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "small.jpg", bytes: await paintJpeg(150, 100) },
    ]);
    expect(result.ok).toBe(true);
  });

  test("a photograph over the configured edge is refused, not decoded", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "big.jpg", bytes: await paintJpeg(400, 300) },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toContainEqual(
      expect.objectContaining({ field: "big.jpg.dimensions" }),
    );
    // Refused before the decode loop, which is where a real pixel bomb's cost
    // would otherwise be paid.
    expect(decodeSource).not.toHaveBeenCalled();
  });

  test("a crafted file claiming more pixels than this server will ever decode is refused before decode", async () => {
    // A small PNG whose header alone declares an enormous image — the header
    // read (sharp's own `limitInputPixels`) is what has to catch this, since
    // decoding it for real is exactly the cost being avoided.
    const bomb = png(20000, 20000);
    const result = await storeUploads(REF, "day-one", [{ filename: "bomb.png", bytes: bomb }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toContainEqual(
      expect.objectContaining({ field: "bomb.png.dimensions" }),
    );
    expect(decodeSource).not.toHaveBeenCalled();
  });
});

/**
 * A PNG with a real IHDR chunk claiming `width`×`height`, and one nearly
 * empty IDAT behind it — not remotely enough compressed data for an image
 * this large, but a well-formed enough file that sharp reads the header
 * rather than bailing out on a corrupt one before it gets the chance to
 * enforce the pixel limit. This is exactly the asymmetry a pixel-bomb upload
 * exploits: bytes in the tens, gigabytes to decode if nothing stops it first.
 */
function png(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // colour type: truecolour
  const ihdr = chunk("IHDR", ihdrData);
  const idat = chunk("IDAT", zlib.deflateSync(Buffer.alloc(1)));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// A minimal CRC-32, so the PNG's own chunk checksums are valid and sharp
// reads the header rather than bailing on a corrupt file before it gets the
// chance to enforce the pixel limit.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

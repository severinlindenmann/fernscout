import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readExif } from "@/lib/ingest/exif";
import {
  DUPLICATE_THRESHOLD,
  contentHash,
  dHash,
  hammingDistance,
  isDuplicate,
} from "@/lib/ingest/hash";
import {
  MAX_EDGE,
  decodeSource,
  heifDecoderName,
  makeDerivative,
  perceptualHash,
} from "@/lib/ingest/image";
import { makeJpeg, withExif } from "./support/exif-jpeg";
import { tmpdir } from "node:os";

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "ingest");

function scratch(): string {
  return fs.mkdtempSync(path.join(tmpdir(), "fernscout-media-test-"));
}

/** Does this JPEG carry an EXIF APP1 segment at all? */
function hasExifSegment(bytes: Uint8Array): boolean {
  for (let i = 0; i + 10 < bytes.length; i++) {
    if (
      bytes[i] === 0xff &&
      bytes[i + 1] === 0xe1 &&
      String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]) === "Exif"
    ) {
      return true;
    }
  }
  return false;
}

describe("served derivatives carry no location", () => {
  test("the fixture we start from really does have GPS in it", () => {
    const exif = readExif(new Uint8Array(fs.readFileSync(path.join(FIXTURES, "camera.jpg"))));
    expect(exif.lat).toBeDefined();
    expect(exif.lng).toBeDefined();
  });

  test("the derivative has no GPS, and no EXIF block for it to hide in", async () => {
    // This is the one that matters. A public photo carrying the coordinates
    // of somebody's front door is a real leak, and it is invisible unless a
    // test looks.
    const source = await decodeSource(path.join(FIXTURES, "camera.jpg"));
    const derivative = await makeDerivative(source);
    source.dispose();

    const exif = readExif(new Uint8Array(derivative.bytes));
    expect(exif.lat).toBeUndefined();
    expect(exif.lng).toBeUndefined();
    expect(exif.make).toBeUndefined();
    expect(hasExifSegment(new Uint8Array(derivative.bytes))).toBe(false);
  });

  test("a WebP derivative is just as clean", async () => {
    const source = await decodeSource(path.join(FIXTURES, "camera.jpg"));
    const derivative = await makeDerivative(source, { format: "webp" });
    source.dispose();
    expect(readExif(new Uint8Array(derivative.bytes)).lat).toBeUndefined();
    expect(derivative.bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });
});

describe("derivatives", () => {
  test("orientation is applied to the pixels, since the tag is thrown away", async () => {
    // camera.jpg is 120x80 with orientation 6 (rotate 90° clockwise), so the
    // right answer is a portrait image. Getting this wrong puts every phone
    // photo on its side.
    const source = await decodeSource(path.join(FIXTURES, "camera.jpg"));
    const derivative = await makeDerivative(source);
    source.dispose();
    expect(derivative.width).toBe(80);
    expect(derivative.height).toBe(120);
  });

  test("large photos come down to the cap and keep their shape", async () => {
    const dir = scratch();
    const file = path.join(dir, "big.jpg");
    fs.writeFileSync(file, await makeJpeg(1, 4000, 3000));
    const source = await decodeSource(file);
    const derivative = await makeDerivative(source);
    source.dispose();
    expect(derivative.width).toBe(MAX_EDGE);
    expect(derivative.height).toBe(1500);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("small photos are not upscaled into blur", async () => {
    const dir = scratch();
    const file = path.join(dir, "small.jpg");
    fs.writeFileSync(file, await makeJpeg(2, 600, 400));
    const source = await decodeSource(file);
    const derivative = await makeDerivative(source);
    source.dispose();
    expect(derivative.width).toBe(600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("HEIC", () => {
  // What sharp's prebuilt libvips can do with HEIC is the thing this package
  // was told to check: it reads the container but has no HEVC decoder, so
  // ingest routes those files through an external converter.
  test.runIf(heifDecoderName() !== null)("an iPhone HEIC decodes and resizes", async () => {
    const source = await decodeSource(path.join(FIXTURES, "phone.heic"));
    expect(source.alreadyOriented).toBe(true);
    const derivative = await makeDerivative(source);
    source.dispose();
    expect(derivative.width).toBeGreaterThan(0);
    expect(derivative.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(readExif(new Uint8Array(derivative.bytes)).lat).toBeUndefined();
  });

  test("its coordinates are still read from the original, not the derivative", () => {
    const exif = readExif(new Uint8Array(fs.readFileSync(path.join(FIXTURES, "phone.heic"))));
    expect(exif.lat).toBeCloseTo(11.9404, 3);
  });

  test("a file nothing can decode fails with an actionable message", async () => {
    const dir = scratch();
    const file = path.join(dir, "broken.jpg");
    fs.writeFileSync(file, Buffer.from("not an image at all"));
    await expect(decodeSource(file)).rejects.toThrow(/Could not decode broken\.jpg/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("perceptual hashing", () => {
  test("a hash is 64 bits of hex", () => {
    expect(dHash(new Uint8Array(72).fill(0))).toMatch(/^[0-9a-f]{16}$/);
  });

  test("re-encoding a photo does not change what it is", async () => {
    const dir = scratch();
    const original = path.join(dir, "a.jpg");
    const reexported = path.join(dir, "b.jpg");
    const bytes = await makeJpeg(7, 1200, 900);
    fs.writeFileSync(original, bytes);
    // Same photograph, exported smaller and at a different quality — the case
    // that defeats a checksum and is exactly why the hash exists.
    const sharp = (await import("sharp")).default;
    fs.writeFileSync(reexported, await sharp(bytes).resize(400).jpeg({ quality: 45 }).toBuffer());

    const a = await perceptualHash(await decodeSource(original));
    const b = await perceptualHash(await decodeSource(reexported));
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(DUPLICATE_THRESHOLD);
    expect(isDuplicate(a, b)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("different photographs are not duplicates", async () => {
    const dir = scratch();
    const files = await Promise.all(
      [1, 2, 3].map(async (seed) => {
        const file = path.join(dir, `${seed}.jpg`);
        fs.writeFileSync(file, await makeJpeg(seed * 11, 800, 600));
        return perceptualHash(await decodeSource(file));
      }),
    );
    expect(isDuplicate(files[0], files[1])).toBe(false);
    expect(isDuplicate(files[1], files[2])).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("content hashes are stable and differ between files", async () => {
    const one = new Uint8Array(await makeJpeg(5));
    const two = new Uint8Array(await makeJpeg(6));
    expect(contentHash(one)).toBe(contentHash(one));
    expect(contentHash(one)).not.toBe(contentHash(two));
  });

  test("hashes of different lengths never compare as similar", () => {
    expect(hammingDistance("abcd", "abcdef")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("EXIF the derivative drops", () => {
  test("a photo whose only metadata is GPS still loses it", async () => {
    const dir = scratch();
    const file = path.join(dir, "home.jpg");
    fs.writeFileSync(file, withExif(await makeJpeg(9), { lat: 47.3769, lng: 8.5417 }));
    expect(readExif(new Uint8Array(fs.readFileSync(file))).lat).toBeCloseTo(47.3769, 3);

    const source = await decodeSource(file);
    const derivative = await makeDerivative(source);
    source.dispose();
    expect(hasExifSegment(new Uint8Array(derivative.bytes))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

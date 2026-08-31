import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fromDate, isoDate, isoTime, readExif, wallClockMs } from "@/lib/ingest/exif";
import { makeJpeg, withExif } from "./support/exif-jpeg";

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "ingest");

function fixture(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
}

describe("EXIF from real files", () => {
  // Both fixtures were written by exiftool, so this pins the parser against
  // what a real camera and a real phone actually produce rather than against
  // our own writer.
  test("reads a JPEG's date, place, orientation and camera", () => {
    const exif = readExif(fixture("camera.jpg"));
    expect(exif.make).toBe("Fujifilm");
    expect(exif.model).toBe("X-T5");
    expect(exif.orientation).toBe(6);
    expect(isoDate(exif.takenAt!)).toBe("2026-08-23");
    expect(isoTime(exif.takenAt!)).toBe("15:42");
    expect(exif.lat).toBeCloseTo(15.8801, 4);
    expect(exif.lng).toBeCloseTo(108.338, 4);
    expect(exif.altitude).toBe(12);
    expect(exif.offset).toBe("+07:00");
  });

  test("reads EXIF out of a HEIC's meta box", () => {
    const exif = readExif(fixture("phone.heic"));
    expect(exif.model).toBe("iPhone 15 Pro");
    expect(isoDate(exif.takenAt!)).toBe("2026-08-24");
    expect(exif.lat).toBeCloseTo(11.9404, 4);
    expect(exif.lng).toBeCloseTo(108.4583, 4);
  });
});

describe("EXIF edge cases", () => {
  test("a file with no EXIF at all reads as empty, not as an error", async () => {
    expect(readExif(new Uint8Array(await makeJpeg(1)))).toEqual({});
  });

  test("truncated and non-image bytes read as empty", () => {
    expect(readExif(fixture("camera.jpg").slice(0, 40))).toEqual({});
    expect(readExif(new Uint8Array([1, 2, 3, 4, 5]))).toEqual({});
    expect(readExif(new Uint8Array(0))).toEqual({});
  });

  test("big-endian TIFF, southern and western hemispheres", async () => {
    const jpeg = withExif(await makeJpeg(2), {
      takenAt: "2026-01-02 18:04:05",
      lat: -20.35,
      lng: -67.5,
      orientation: 8,
    });
    const exif = readExif(new Uint8Array(jpeg));
    expect(exif.lat).toBeCloseTo(-20.35, 4);
    expect(exif.lng).toBeCloseTo(-67.5, 4);
    expect(exif.orientation).toBe(8);
    expect(isoDate(exif.takenAt!)).toBe("2026-01-02");
    expect(isoTime(exif.takenAt!)).toBe("18:04");
  });

  test("a dead clock battery's 0000:00:00 is discarded", async () => {
    const jpeg = withExif(await makeJpeg(3), { takenAt: "0000:00:00 00:00:00" });
    expect(readExif(new Uint8Array(jpeg)).takenAt).toBeUndefined();
  });

  test("a null island fix is discarded", async () => {
    const jpeg = withExif(await makeJpeg(4), { lat: 0, lng: 0 });
    const exif = readExif(new Uint8Array(jpeg));
    expect(exif.lat).toBeUndefined();
    expect(exif.lng).toBeUndefined();
  });
});

describe("wall-clock timestamps", () => {
  test("round-trip through the sortable form keeps the local reading", () => {
    const date = { year: 2026, month: 8, day: 14, hour: 7, minute: 20, second: 31 };
    expect(new Date(wallClockMs(date)).toISOString()).toBe("2026-08-14T07:20:31.000Z");
  });

  test("an hour apart is an hour apart", () => {
    const a = wallClockMs({ year: 2026, month: 8, day: 14, hour: 7, minute: 0, second: 0 });
    const b = wallClockMs({ year: 2026, month: 8, day: 14, hour: 8, minute: 0, second: 0 });
    expect(b - a).toBe(3_600_000);
  });

  test("a file's mtime converts into the same shape", () => {
    const parsed = fromDate(new Date(2026, 7, 14, 7, 20, 31));
    expect(isoDate(parsed)).toBe("2026-08-14");
    expect(isoTime(parsed)).toBe("07:20");
  });
});

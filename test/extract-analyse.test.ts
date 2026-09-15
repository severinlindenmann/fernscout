import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { analyseStaged } from "@/lib/extract/analyse";

const base = { id: "a.jpeg", filename: "camera.jpg", bytes: 2007 };

describe("analysing a staged photograph", () => {
  test("reads place, time and camera out of a real file", () => {
    const row = analyseStaged(base, fs.readFileSync("test/fixtures/ingest/camera.jpg"));
    expect(row.kind).toBe("image");
    expect(row.offset).toBe("+07:00");
    expect(row.lat).toBeCloseTo(15.8801, 3);
    expect(row.model).toBe("X-T5");
    expect(row.date).toBe("2026-08-23");
  });

  test("a file with no exif gets no fields at all — not a fallback to today", () => {
    const row = analyseStaged({ ...base, filename: "plain.jpg" }, Buffer.from("not a photograph"));
    expect(row.takenAt).toBeUndefined();
    expect(row.date).toBeUndefined();
    expect(row.lat).toBeUndefined();
  });

  test("a video is staged but contributes no location — B1755", () => {
    const row = analyseStaged({ ...base, id: "a.mov", filename: "IMG_1.mov" }, Buffer.from("\0\0\0\x14ftypqt  "));
    expect(row.kind).toBe("video");
    expect(row.lat).toBeUndefined();
  });
});

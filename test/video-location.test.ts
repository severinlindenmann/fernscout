import { describe, expect, test } from "vitest";
import { readLocation } from "@/lib/ingest/video";

const TAG = "com.apple.quicktime.location.ISO6709";

describe("readLocation — B1755", () => {
  // Measured, not invented: an iPhone 15 clip sent to the live instance under
  // B1860, captured 2026-09-19. This is the exact literal ffprobe handed
  // back for `format.tags["com.apple.quicktime.location.ISO6709"]`.
  test("parses the real B1860 measurement, altitude and all", () => {
    const loc = readLocation({ [TAG]: "+47.4156+008.2563+386.198/" });
    expect(loc).toEqual({ lat: 47.4156, lng: 8.2563 });
  });

  test("a southern, western fix — both signs negative — parses correctly", () => {
    // Rio de Janeiro. A naive split on "+" or "-" loses which half a sign
    // belongs to once both are negative; the regex keeps each sign glued to
    // its own number.
    const loc = readLocation({ [TAG]: "-22.9068-43.1729/" });
    expect(loc).toEqual({ lat: -22.9068, lng: -43.1729 });
  });

  test("a southern-only fix (positive longitude) parses correctly", () => {
    // Sydney — the ticket's own example, one negative sign and one positive.
    const loc = readLocation({ [TAG]: "-33.8688+151.2093/" });
    expect(loc).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  test("no altitude and no trailing solidus still parses", () => {
    const loc = readLocation({ [TAG]: "+47.4156+008.2563" });
    expect(loc).toEqual({ lat: 47.4156, lng: 8.2563 });
  });

  test("a missing tags object yields no coordinates", () => {
    expect(readLocation(undefined)).toBeUndefined();
  });

  test("a tags object without the key yields no coordinates", () => {
    expect(readLocation({ "com.apple.quicktime.make": "Apple" })).toBeUndefined();
  });

  test("an empty tag yields no coordinates", () => {
    expect(readLocation({ [TAG]: "" })).toBeUndefined();
  });

  test("a malformed tag yields no coordinates, not a throw", () => {
    expect(() => readLocation({ [TAG]: "not a coordinate" })).not.toThrow();
    expect(readLocation({ [TAG]: "not a coordinate" })).toBeUndefined();
    // Missing the mandatory sign is malformed too, not just prose.
    expect(readLocation({ [TAG]: "47.4156+008.2563/" })).toBeUndefined();
  });

  test("an out-of-range reading (a corrupt tag) is dropped", () => {
    expect(readLocation({ [TAG]: "+950.0000+008.0000/" })).toBeUndefined();
    expect(readLocation({ [TAG]: "+47.0000+800.0000/" })).toBeUndefined();
  });

  test("null island — no fix — is dropped, matching the EXIF reader", () => {
    expect(readLocation({ [TAG]: "+00.0000+000.0000/" })).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRecorderState, recordingState, writeRecorderState } from "@/lib/gps/recorderState";

/**
 * B2542 — the phone's own latest "am I actually recording" report. Pure
 * module-level tests: no HTTP, one function in, one answer out, the same
 * level `test/gps-track-edits.test.ts` exercises `deriveTrack` at.
 */

const USER = "ana";
const TRIP = "algarve";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-recorder-state-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("readRecorderState / writeRecorderState", () => {
  test("nothing on disk reads as no report at all", () => {
    expect(readRecorderState(USER, TRIP)).toBeUndefined();
    expect(recordingState(USER, TRIP)).toBeNull();
  });

  test("round-trips a written report, with the server's own receivedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    writeRecorderState(USER, TRIP, { armed: true, permission: "always", appVersion: "1.4" });
    const report = readRecorderState(USER, TRIP);
    expect(report).toEqual({
      armed: true,
      permission: "always",
      appVersion: "1.4",
      receivedAt: "2026-06-22T12:00:00.000Z",
    });
  });

  test("a malformed file reads as no report, not a thrown error", () => {
    fs.mkdirSync(path.join(dir, USER, "trips", TRIP), { recursive: true });
    fs.writeFileSync(path.join(dir, USER, "trips", TRIP, "recorder-state.json"), "not json");
    expect(readRecorderState(USER, TRIP)).toBeUndefined();
    expect(recordingState(USER, TRIP)).toBeNull();
  });

  test("an unrecognised permission string is dropped, not trusted", () => {
    writeRecorderState(USER, TRIP, { armed: true });
    fs.writeFileSync(
      path.join(dir, USER, "trips", TRIP, "recorder-state.json"),
      JSON.stringify({ armed: true, permission: "sometimes", receivedAt: "2026-06-22T12:00:00Z" }),
    );
    expect(readRecorderState(USER, TRIP)?.permission).toBeUndefined();
  });
});

describe("recordingState — the three states", () => {
  test("armed with Always permission and a fresh report reads as recording", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    writeRecorderState(USER, TRIP, { armed: true, permission: "always" });
    vi.setSystemTime(new Date("2026-06-22T12:10:00Z"));
    expect(recordingState(USER, TRIP)?.state).toBe("recording");
  });

  test("armed: false reads as off, whatever the permission", () => {
    writeRecorderState(USER, TRIP, { armed: false, permission: "always" });
    expect(recordingState(USER, TRIP)).toMatchObject({ state: "off" });
  });

  test("armed with anything but Always reads as silent, reason permission", () => {
    writeRecorderState(USER, TRIP, { armed: true, permission: "whenInUse" });
    expect(recordingState(USER, TRIP)).toMatchObject({ state: "silent", reason: "permission" });
  });

  test("armed, Always, but nothing received in over six hours reads as silent, reason stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    writeRecorderState(USER, TRIP, { armed: true, permission: "always" });
    vi.setSystemTime(new Date("2026-06-22T18:00:01Z"));
    expect(recordingState(USER, TRIP)).toMatchObject({ state: "silent", reason: "stale" });
  });

  test("just under six hours old still reads as recording", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    writeRecorderState(USER, TRIP, { armed: true, permission: "always" });
    vi.setSystemTime(new Date("2026-06-22T17:59:00Z"));
    expect(recordingState(USER, TRIP)?.state).toBe("recording");
  });

  test("carries armedUntil and lastReport through, never a coordinate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    writeRecorderState(USER, TRIP, { armed: true, permission: "always", armedUntil: "2026-06-26T00:00:00Z" });
    const state = recordingState(USER, TRIP);
    expect(state).toMatchObject({
      state: "recording",
      armedUntil: "2026-06-26T00:00:00Z",
      lastReport: "2026-06-22T12:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toMatch(/-?\d+\.\d{4,}/); // no lat/lon-shaped number
  });
});

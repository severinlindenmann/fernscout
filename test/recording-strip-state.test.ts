import { describe, expect, test } from "vitest";
import { stripState } from "@/components/studio/location/RecordingStrip";
import type { RecordingState } from "@/lib/gps/recorderState";

/**
 * B2563 T2 — the six states the plan names, tested as the pure decision
 * function `RecordingStrip` renders from. Kept independent of React so this
 * never needs a DOM, a locale dictionary or `useNativeShell` mocked to prove
 * the state itself is picked correctly.
 */
describe("stripState — B2563 T2's six recorder states", () => {
  test("no home zone yet wins over everything else", () => {
    expect(stripState(false, { state: "recording", lastReport: "x" })).toEqual({ kind: "homeFirst" });
    expect(stripState(false, null)).toEqual({ kind: "homeFirst" });
  });

  test("no report at all — recordingState() returned null", () => {
    expect(stripState(true, null)).toEqual({ kind: "noReport" });
  });

  test("off", () => {
    const off: RecordingState = { state: "off", lastReport: "x" };
    expect(stripState(true, off)).toEqual({ kind: "off" });
  });

  test("silent because of permission", () => {
    const silent: RecordingState = { state: "silent", reason: "permission", lastReport: "x" };
    expect(stripState(true, silent)).toEqual({ kind: "needsAlways" });
  });

  test("silent because stale", () => {
    const silent: RecordingState = { state: "silent", reason: "stale", lastReport: "x" };
    expect(stripState(true, silent)).toEqual({ kind: "silentStale" });
  });

  test("recording", () => {
    const recording: RecordingState = { state: "recording", lastReport: "x" };
    expect(stripState(true, recording)).toEqual({ kind: "recording" });
  });
});

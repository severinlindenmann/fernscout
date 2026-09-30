import { describe, expect, test } from "vitest";
import { stripState } from "@/components/studio/location/RecordingStrip";
import type { RecordingState } from "@/lib/gps/recorderState";

/**
 * B2563 T2 — the five states the plan names, tested as the pure decision
 * function `RecordingStrip` renders from. Kept independent of React so this
 * never needs a DOM, a locale dictionary or `useNativeShell` mocked to prove
 * the state itself is picked correctly.
 *
 * B2568 dropped the sixth state, "homeFirst" — recording no longer waits on
 * a saved home zone or a decline.
 */
describe("stripState — B2563 T2's five recorder states", () => {
  test("no report at all — recordingState() returned null", () => {
    expect(stripState(null)).toEqual({ kind: "noReport" });
  });

  test("off", () => {
    const off: RecordingState = { state: "off", lastReport: "x" };
    expect(stripState(off)).toEqual({ kind: "off" });
  });

  test("silent because of permission", () => {
    const silent: RecordingState = { state: "silent", reason: "permission", lastReport: "x" };
    expect(stripState(silent)).toEqual({ kind: "needsAlways" });
  });

  test("silent because stale", () => {
    const silent: RecordingState = { state: "silent", reason: "stale", lastReport: "x" };
    expect(stripState(silent)).toEqual({ kind: "silentStale" });
  });

  test("recording", () => {
    const recording: RecordingState = { state: "recording", lastReport: "x" };
    expect(stripState(recording)).toEqual({ kind: "recording" });
  });
});

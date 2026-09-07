import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MAX_VIDEO_BITRATE, transcodeVideo, videoToolsAvailable } from "@/lib/ingest/video";

/**
 * What a reader actually downloads — B679.
 *
 * `-crf` targets a quality and has no upper bound, so the served copy of real
 * footage came out at 3.7–5.1 Mbps: ~38 MB per minute, to every reader who
 * opens the day, every time. Fine at a 90-second cap and not at a five-minute
 * one.
 *
 * Asserted by encoding and measuring rather than by reading the arguments
 * back, because the argument list is not the promise — the bytes are, and an
 * encoder that ignored `-maxrate` would pass an argument test happily.
 */

let dir: string;

/** Noise, which is the only thing h264 cannot cheat its way out of. A cheerful
 * test pattern compresses to nearly nothing and would pass with no ceiling at
 * all, which is a test that proves the fixture rather than the code. */
function noiseClip(file: string, seconds: number): boolean {
  const made = spawnSync("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-f", "lavfi",
    "-i", `nullsrc=s=640x480,geq=random(1)*255:128:128`,
    "-t", String(seconds),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    file,
  ]);
  return made.status === 0;
}

function bitrateOf(file: string): number {
  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number(String(probe.stdout).trim());
  return (fs.statSync(file).size * 8) / seconds;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-bitrate-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a served clip is held under the bitrate ceiling", () => {
  if (!videoToolsAvailable()) return; // No ffmpeg here; nothing to measure.

  const source = path.join(dir, "noise.mp4");
  if (!noiseClip(source, 3)) throw new Error("could not make a test clip");

  // The fixture has to be demanding enough to matter: encoded the old way —
  // a quality target and nothing else — it goes well past the ceiling. If this
  // ever stops being true the test below has stopped proving anything.
  const unbounded = path.join(dir, "unbounded.mp4");
  transcodeVideo(source, unbounded, { maxBitrate: 100_000_000 });
  expect(bitrateOf(unbounded)).toBeGreaterThan(MAX_VIDEO_BITRATE * 2);

  const served = path.join(dir, "served.mp4");
  transcodeVideo(source, served);

  // A little over the video ceiling is expected and correct: `-maxrate` bounds
  // the video, and the file also carries audio and container overhead.
  expect(bitrateOf(served)).toBeLessThan(MAX_VIDEO_BITRATE * 1.4);
}, 120_000);

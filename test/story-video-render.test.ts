import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { renderStoryVideo, type StorySegment } from "@/lib/storyVideo";
import type { StoryFacts } from "@/lib/storyCard";

/**
 * A real render, through a real ffmpeg — B2665 round 2. Every other test
 * for this module mocks ffmpeg away; this one actually calls it, because
 * the bug that sent this round back (ffmpeg 7.1 on the production server
 * refusing `xfade` on a variable-frame-rate input) only shows up once a real
 * binary decodes the filter graph. CI's Ubuntu runner may or may not have
 * ffmpeg on PATH, and this Mac's own `/usr/local/bin/ffmpeg` is an x86
 * binary that cannot spawn under this Node at all (`spawnSync` comes back
 * with `status: null`, not an exit code) — either way this must skip
 * cleanly, never fail for ffmpeg's absence.
 */
const ffmpegWorks = spawnSync("ffmpeg", ["-version"]).status === 0;
const ffprobeWorks = spawnSync("ffprobe", ["-version"]).status === 0;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-story-video-render-"));
  resetRateLimitsForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function jpeg(name: string, width: number, height: number): Promise<string> {
  const file = path.join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 120 } } })
    .jpeg()
    .toFile(file);
  return file;
}

function facts(link: string | undefined): StoryFacts {
  return {
    title: "Up the Narrows",
    headline: "Up the Narrows",
    dateLabel: "Sat 6 Sep 2025",
    dayLabel: "Day 2",
    tripTitle: "Eighteen days",
    place: "Zion National Park",
    tempLine: "13–25 °C",
    subLine: "Zion National Park · 13–25 °C",
    link,
    photos: [],
  };
}

async function ffprobeJson(file: string): Promise<{ format: { duration: string }; streams: { avg_frame_rate: string }[] }> {
  const run = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate", "-show_entries", "format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  return JSON.parse(run.stdout);
}

describe.skipIf(!ffmpegWorks || !ffprobeWorks)("renderStoryVideo — a real ffmpeg render", () => {
  test.each([1, 2, 3])("renders a decodable, ~8s, 25fps clip from %i real photograph(s)", async (count) => {
    const sizes: [number, number][] = [
      [1600, 1200], // landscape
      [1200, 1600], // portrait
      [1920, 1080], // landscape, different ratio
    ];
    const segments: StorySegment[] = [];
    for (let i = 0; i < count; i++) {
      const [w, h] = sizes[i];
      segments.push({ file: await jpeg(`p${i}.jpg`, w, h), caption: i === 0 ? "A caption" : undefined });
    }

    const bytes = await renderStoryVideo({
      key: `render-test-${count}`,
      segments,
      facts: facts(count === 1 ? "https://t.test/@a/trips/x/day/y" : undefined),
      rateLimitKey: `render-test-${count}`,
      showCaptions: true,
    });
    expect(bytes).not.toBeNull();
    expect(bytes).not.toBe("rate_limited");
    const clip = bytes as Buffer;

    const outFile = path.join(dir, `out-${count}.mp4`);
    fs.writeFileSync(outFile, clip);
    const probed = await ffprobeJson(outFile);

    expect(Number(probed.format.duration)).toBeGreaterThan(7.8);
    expect(Number(probed.format.duration)).toBeLessThan(8.2);
    expect(probed.streams[0]?.avg_frame_rate).toBe("25/1");
  }, 30_000);
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storyPhotoFile } from "@/lib/storyMedia";

/**
 * `storyPhotoFile` — B2665. A day's own `media[].src` is content a day
 * document can carry, so "Share as a story" (the picture route and the
 * video route both) has to re-prove it cannot be walked outside the
 * owner's own media folder before reading bytes off disk — the same guard
 * `resolveMediaFile` already enforces for every served photograph
 * (`app/at/[user]/media/[...path]/route.ts`), reused rather than
 * reimplemented.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-story-media-"));
  process.env.CONTENT_DIR = dir;
  const mediaDir = path.join(dir, "alex", "trips", "t", "media", "day");
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, "01.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  // A secret the traversal attempt below must never reach.
  fs.writeFileSync(path.join(dir, "alex", "secret.json"), "{}");
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("storyPhotoFile", () => {
  test("resolves a real photograph under the trip's own media folder", () => {
    const file = storyPhotoFile("alex", "/media/t/day/01.jpg");
    expect(file).toBe(path.join(dir, "alex", "trips", "t", "media", "day", "01.jpg"));
  });

  test("refuses a src that tries to walk out of the trip's media folder", () => {
    expect(storyPhotoFile("alex", "/media/t/../../secret.json")).toBeNull();
    expect(storyPhotoFile("alex", "/media/t/day/../../../secret.json")).toBeNull();
  });

  test("refuses anything that is not under /media/", () => {
    expect(storyPhotoFile("alex", "/etc/passwd")).toBeNull();
  });

  test("refuses a file that is not an image (e.g. a video)", () => {
    const videoDir = path.join(dir, "alex", "trips", "t", "media", "day");
    fs.writeFileSync(path.join(videoDir, "clip.mp4"), Buffer.from([0, 0, 0]));
    expect(storyPhotoFile("alex", "/media/t/day/clip.mp4")).toBeNull();
  });
});

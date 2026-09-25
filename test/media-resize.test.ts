import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { MEDIA_WIDTHS, nearestWidth, parseWidth } from "@/lib/mediaSizes";
import { mediaLoader } from "@/components/mediaLoader";

/**
 * The media route is its own image optimiser, because Next's cannot be used
 * here: `/_next/image` re-fetches the source through a mocked request carrying
 * no cookies, so a route that asks who is reading sees a stranger and refuses.
 * Every photograph on a trip that is not public came back as a blank square.
 */

let dir: string;
let file: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-resize-"));
  process.env.CONTENT_DIR = dir;
  file = path.join(dir, "big.jpg");
  await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: "#3fa9c4" },
  })
    .jpeg()
    .toFile(file);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the widths on offer", () => {
  test("a request is rounded up to one of them, never served raw", () => {
    expect(nearestWidth(400)).toBe(480);
    expect(nearestWidth(640)).toBe(640);
    expect(MEDIA_WIDTHS).toContain(nearestWidth(1));
  });

  /** `?w=` off the query string, unbounded, is a disk-filling machine. */
  test("something enormous lands on the largest width, not on itself", () => {
    expect(nearestWidth(99999)).toBe(MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1]);
    expect(parseWidth("99999")).toBe(MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1]);
  });

  test("nonsense means no resize at all", () => {
    for (const bad of [null, "", "abc", "-5", "0", "NaN", "1e400"]) {
      expect(parseWidth(bad)).toBe(null);
    }
  });
});

describe("the loader", () => {
  test("asks the media route, not /_next/image", () => {
    expect(mediaLoader({ src: "/alex/media/trip/day/01.jpg", width: 400 })).toBe(
      "/alex/media/trip/day/01.jpg?w=480",
    );
  });

  test("leaves alone what it cannot resize", () => {
    expect(mediaLoader({ src: "/alex/media/t/d/01.svg", width: 400 })).toBe("/alex/media/t/d/01.svg");
    expect(mediaLoader({ src: "https://elsewhere.test/a.jpg", width: 400 })).toBe(
      "https://elsewhere.test/a.jpg",
    );
  });
});

describe("resizing", () => {
  test("a thumbnail is small, and webp", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const bytes = await resizedCopy(file, 480);
    const meta = await sharp(bytes!).metadata();
    expect(meta.width).toBe(480);
    expect(meta.format).toBe("webp");
    expect(bytes!.byteLength).toBeLessThan(fs.statSync(file).size / 4);
  });

  test("a small photograph is not blown up into a bigger file", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const small = path.join(dir, "small.jpg");
    await sharp({ create: { width: 300, height: 200, channels: 3, background: "#fff" } })
      .jpeg()
      .toFile(small);
    expect((await sharp((await resizedCopy(small, 2000))!).metadata()).width).toBe(300);
  });

  test("the answer is kept, and the second ask reads it back", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const first = await resizedCopy(file, 640);
    const held = fs.readdirSync(path.join(dir, ".cache", "media"));
    expect(held).toHaveLength(1);
    expect(await resizedCopy(file, 640)).toEqual(first);
  });

  /**
   * The cache holds copies of pictures whose whole point is that not everyone
   * may fetch them, so it must not sit anywhere a URL can reach. `.cache` is
   * also skipped when the content root is read as a list of people.
   */
  test("kept outside any trip's media directory", async () => {
    const { resizedCopy } = await import("@/lib/media");
    await resizedCopy(file, 640);
    expect(fs.existsSync(path.join(dir, ".cache", "media"))).toBe(true);
  });

  test("replacing the file in place does not serve the old one forever", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const before = await resizedCopy(file, 640);
    await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#f06a8a" } })
      .jpeg()
      .toFile(file);
    expect(await resizedCopy(file, 640)).not.toEqual(before);
  });

  test("something that is not an image is served as it is", async () => {
    const { resizedCopy } = await import("@/lib/media");
    const video = path.join(dir, "clip.mp4");
    fs.writeFileSync(video, "not really a video");
    expect(await resizedCopy(video, 640)).toBe(null);

    const broken = path.join(dir, "broken.jpg");
    fs.writeFileSync(broken, "not really a jpeg");
    expect(await resizedCopy(broken, 640)).toBe(null);
  });
});

import { describe, expect, test } from "vitest";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  validateMediaBatch,
  validateMediaItem,
} from "@/lib/validate/media";

/**
 * The limits, and how they are said.
 *
 * "Too big" is useless to whoever is holding the file: the message has to
 * carry the limit *and* what arrived, so an agent can decide whether to
 * resize or to go back to the person. Every assertion here is about that
 * pairing as much as about the rejection.
 */

const photo = { name: "01.jpg", kind: "image" as const };
const clip = { name: "clip.mp4", kind: "video" as const };

describe("images", () => {
  test("an accepted format passes", () => {
    for (const format of ["jpeg", "png", "heic", "heif", "webp", "JPEG"]) {
      expect(validateMediaItem({ ...photo, format }), format).toEqual([]);
    }
  });

  test("a format we cannot read is refused, and the message lists what we can", () => {
    const [problem] = validateMediaItem({ ...photo, format: "tiff" });
    expect(problem.field).toBe("01.jpg.format");
    expect(problem.got).toBe("tiff");
    expect(problem.expected).toContain("heic");
  });

  test("too many bytes reports the limit and the actual size", () => {
    const [problem] = validateMediaItem({ ...photo, bytes: IMAGE_MAX_BYTES + 1 });
    expect(problem.field).toBe("01.jpg.size");
    expect(problem.got).toBe("50.0 MB");
    expect(problem.expected).toBe("at most 50.0 MB");
  });

  test("exactly the limit is fine — the boundary is inclusive", () => {
    expect(validateMediaItem({ ...photo, bytes: IMAGE_MAX_BYTES })).toEqual([]);
    expect(validateMediaItem({ ...photo, longestEdge: IMAGE_MAX_EDGE })).toEqual([]);
  });

  test("a scan the size of a wall is refused", () => {
    const [problem] = validateMediaItem({ ...photo, longestEdge: IMAGE_MAX_EDGE + 1 });
    expect(problem.field).toBe("01.jpg.dimensions");
    expect(problem.got).toBe(`${IMAGE_MAX_EDGE + 1}px`);
  });

  /** Ingest gates on its own wider extension list first, so an item with no
   * declared format is not re-litigated here. */
  test("no declared format skips the format check", () => {
    expect(validateMediaItem({ ...photo, bytes: 1000 })).toEqual([]);
  });
});

describe("video", () => {
  test("a long clip is refused, with the limit", () => {
    const [problem] = validateMediaItem({ ...clip, durationSeconds: VIDEO_MAX_SECONDS + 30 });
    expect(problem.field).toBe("clip.mp4.duration");
    expect(problem.got).toBe(`${VIDEO_MAX_SECONDS + 30}s`);
    expect(problem.expected).toBe(`at most ${VIDEO_MAX_SECONDS}s`);
  });

  test("video gets its own, larger byte budget", () => {
    expect(validateMediaItem({ ...clip, bytes: IMAGE_MAX_BYTES + 1 })).toEqual([]);
    expect(validateMediaItem({ ...clip, bytes: VIDEO_MAX_BYTES + 1 })).toHaveLength(1);
  });

  test("an image format is not a video format", () => {
    expect(validateMediaItem({ ...clip, format: "jpeg" })).toHaveLength(1);
    expect(validateMediaItem({ ...clip, format: "mp4" })).toEqual([]);
  });
});

describe("a day's worth", () => {
  test("every item's problems come back together", () => {
    const problems = validateMediaBatch([
      { ...photo, format: "tiff" },
      { name: "02.jpg", kind: "image", bytes: IMAGE_MAX_BYTES + 1 },
    ]);
    expect(problems.map((p) => p.field)).toEqual(["01.jpg.format", "02.jpg.size"]);
  });

  test("too many items for one day is its own problem", () => {
    const many = Array.from({ length: MAX_ITEMS_PER_DAY + 1 }, (_, i) => ({
      name: `${i}.jpg`,
      kind: "image" as const,
    }));
    const problems = validateMediaBatch(many);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      field: "media",
      got: `${MAX_ITEMS_PER_DAY + 1} items`,
    });
    expect(validateMediaBatch(many.slice(0, MAX_ITEMS_PER_DAY))).toEqual([]);
  });
});

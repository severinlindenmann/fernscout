import { describe, expect, test } from "vitest";
import { parseRange } from "@/lib/mediaRange";

/**
 * Seeking a clip — B669.
 *
 * The media route answered every request with the whole file and no
 * `Accept-Ranges`, which is right for a photograph and two faults for a video:
 * a scrubber dragged past what has downloaded snaps back, and Safari will not
 * begin playing an mp4 that was served as a `200` at all.
 *
 * The parsing is what is worth guarding. Everything else on that route is a
 * permission check with its own tests, and the range is decided after all of
 * them — a slice of a file this reader has already been allowed to have.
 */
describe("parseRange", () => {
  test("a plain range", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  test("an open-ended range is the rest of the file", () => {
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  test("a suffix range is the last n bytes, not the first", () => {
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("an end past the file is clamped rather than refused", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  /**
   * A player asking for the whole of a 200 MB clip gets a window and comes
   * back for the next one. Answering "the rest of it" literally is 200 MB held
   * in memory per viewer, which is the cost this was meant to remove.
   */
  test("a window, not the whole file, however much is asked for", () => {
    const range = parseRange("bytes=0-", 400 * 1024 * 1024);
    expect(range).not.toBe("invalid");
    expect(range).toBeDefined();
    const { start, end } = range as { start: number; end: number };
    expect(start).toBe(0);
    expect(end - start + 1).toBe(4 * 1024 * 1024);
  });

  test("a start past the end of the file is unsatisfiable, not ignored", () => {
    expect(parseRange("bytes=1000-1200", 1000)).toBe("invalid");
    expect(parseRange("bytes=800-700", 1000)).toBe("invalid");
  });

  /** Anything else is served as an ordinary 200, which is what the spec asks
   * for — including the multipart form no browser sends for media. */
  test("what it does not understand, it does not answer", () => {
    expect(parseRange(null, 1000)).toBeUndefined();
    expect(parseRange("bytes=0-99, 200-299", 1000)).toBeUndefined();
    expect(parseRange("items=0-99", 1000)).toBeUndefined();
    expect(parseRange("bytes=-", 1000)).toBeUndefined();
  });
});

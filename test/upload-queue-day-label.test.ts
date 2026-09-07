import { describe, expect, test } from "vitest";
import { uploadingDaySlug, type QueueProgress } from "@/components/uploadQueue";

/**
 * B721 — the upload progress line follows the person through the wizard,
 * which is right, but a queue row is keyed to the day it was picked for. So
 * somebody who picks photographs, walks on, and opens a different unfinished
 * draft used to see the first day's originals climbing with nothing on
 * screen saying whose they were.
 */
function progress(over: Partial<QueueProgress> = {}): QueueProgress {
  return { webDone: 1, webTotal: 2, originalDone: 0, originalTotal: 2, error: null, slug: null, ...over };
}

describe("uploadingDaySlug", () => {
  test("names nothing when the queue is empty", () => {
    expect(uploadingDaySlug(progress({ slug: null }), "2026-05-04-a-day")).toBeNull();
  });

  test("names nothing when the queue is about the day on screen", () => {
    expect(uploadingDaySlug(progress({ slug: "2026-05-04-a-day" }), "2026-05-04-a-day")).toBeNull();
  });

  test("names the day when it differs from the one on screen", () => {
    expect(uploadingDaySlug(progress({ slug: "2026-05-04-a-day" }), "2026-05-05-another-day")).toBe(
      "2026-05-04-a-day",
    );
  });

  test("names the day when nothing is on screen yet", () => {
    expect(uploadingDaySlug(progress({ slug: "2026-05-04-a-day" }), undefined)).toBe("2026-05-04-a-day");
  });
});

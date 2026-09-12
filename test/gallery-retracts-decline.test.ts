import { describe, expect, test } from "vitest";
import { appendGallery } from "@/lib/ingest/entry";

/**
 * A day that said it had no photographs, and now has some.
 *
 * B540 — a media upload left `without: [photos]` standing beside a gallery of
 * five, so the day claimed both. `editEntry` already retracts a decline an
 * edit answers; photographs are answered by a different call, and that call
 * was not doing it.
 */
const day = (frontmatter: string) => `---\ntitle: "Ein Tag"\ndate: "2026-05-10"\n${frontmatter}---\n\nDie Prosa.\n`;
const item = { src: "/media/t/d/01.jpg", type: "image" as const, width: 10, height: 10 };

describe("appending photographs to a day that declined them", () => {
  test("drops the photos decline", () => {
    const out = appendGallery(day("without: [photos]\n"), [item]);
    expect(out).not.toContain("without:");
    expect(out).toContain("gallery:");
  });

  test("leaves the other declines alone", () => {
    const out = appendGallery(day("without: [costs, photos]\n"), [item]);
    expect(out).toContain("without: [costs]");
  });

  test("does not put the gallery into the prose when the line goes", () => {
    const out = appendGallery(day("without: [photos]\n"), [item]) ?? "";
    const closing = out.split("\n").findIndex((line, i) => i > 0 && line.trim() === "---");
    expect(out.split("\n").findIndex((l) => l.trim() === "gallery:")).toBeLessThan(closing);
    expect(out.trimEnd().endsWith("Die Prosa.")).toBe(true);
  });

  test("a day with no decline is untouched apart from the gallery", () => {
    const out = appendGallery(day(""), [item]) ?? "";
    expect(out).toContain("gallery:");
    expect(out).not.toContain("without:");
  });

  /**
   * B1564 — the same rule for the other decline. `unrecorded: [photos]` says
   * nobody knows whether there were any; a gallery arriving answers that as
   * plainly as `without:` does, and the gallery-append path (attach_files, the
   * media-upload day-attach) left it standing while `editEntry` already
   * retracted it on an edit.
   */
  test("drops the photos unrecorded mark", () => {
    const out = appendGallery(day("unrecorded: [photos]\n"), [item]);
    expect(out).not.toContain("unrecorded:");
    expect(out).toContain("gallery:");
  });

  test("leaves the other unrecorded marks alone", () => {
    const out = appendGallery(day("unrecorded: [costs, photos]\n"), [item]);
    expect(out).toContain("unrecorded: [costs]");
  });

  test("drops both a decline and an unrecorded mark on the same day", () => {
    const out = appendGallery(day("without: [photos]\nunrecorded: [coordinates, photos]\n"), [item]);
    expect(out).not.toContain("without:");
    expect(out).toContain("unrecorded: [coordinates]");
    expect(out).toContain("gallery:");
  });
});

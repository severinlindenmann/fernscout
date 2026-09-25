import { describe, expect, test } from "vitest";
import { appendGallery } from "@/lib/ingest/entry";
import { dayToJson, dayFromJson, type DayFile } from "@/lib/api/v2/documents";

/**
 * A day that said it had no photographs, and now has some.
 *
 * B540 — a media upload left `without: [photos]` standing beside a gallery of
 * five, so the day claimed both. `editEntry` already retracts a decline an
 * edit answers; photographs are answered by a different call, and that call
 * was not doing it.
 *
 * B1598 moved this to JSON, and in doing so collapsed the two v1 spellings
 * into one. `without: [photos]` ("there were none") and `unrecorded:
 * [photos]` ("nobody knows whether there were any") are both `declined.media`
 * now, whose free-text reason carries the difference for a person to read and
 * nothing to branch on. So the two decline cases below are one case, tested
 * once each way round: the reason text differs, the retraction does not.
 * That is a genuine loss of a distinction at the *type* level, and it is
 * deliberate (decision 4) — what must not be lost is the property itself,
 * which is that a gallery arriving answers the claim either way.
 */
const day = (declined?: Record<string, string>): string =>
  dayToJson({
    slug: "ein-tag",
    title: "Ein Tag",
    date: "2026-05-10",
    content: "Die Prosa.",
    status: "published",
    ...(declined ? { declined } : {}),
  } as DayFile);

const item = { src: "/media/t/d/01.jpg", type: "image" as const, width: 10, height: 10 };
const read = (raw: string | null): DayFile => dayFromJson("ein-tag", raw ?? "");

describe("appending photographs to a day that declined them", () => {
  test("drops the media decline", () => {
    const out = read(appendGallery(day({ media: "there were none" }), [item]));
    expect(out.declined?.media).toBeUndefined();
    expect(out.media).toHaveLength(1);
  });

  test("drops it whichever of the two v1 meanings the reason carries", () => {
    const out = read(appendGallery(day({ media: "nobody knows whether there were any" }), [item]));
    expect(out.declined?.media).toBeUndefined();
    expect(out.media).toHaveLength(1);
  });

  test("leaves the other declines alone", () => {
    const out = read(appendGallery(day({ media: "none", costs: "not tracked" }), [item]));
    expect(out.declined?.costs).toBe("not tracked");
    expect(out.declined?.media).toBeUndefined();
  });

  test("drops the whole declined block when media was the only entry in it", () => {
    const out = read(appendGallery(day({ media: "none" }), [item]));
    expect(out.declined).toBeUndefined();
  });

  test("does not put the gallery into the prose", () => {
    const out = read(appendGallery(day({ media: "none" }), [item]));
    expect(out.content).toBe("Die Prosa.");
  });

  test("a day with no decline is untouched apart from the gallery", () => {
    const out = read(appendGallery(day(), [item]));
    expect(out.declined).toBeUndefined();
    expect(out.media).toHaveLength(1);
    expect(out.content).toBe("Die Prosa.");
    expect(out.title).toBe("Ein Tag");
  });

  test("an unparseable document is refused rather than half-written", () => {
    expect(appendGallery("{ not json", [item])).toBeNull();
  });
});

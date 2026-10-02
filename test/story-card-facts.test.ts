import { describe, expect, test } from "vitest";
import { storyCardFacts, dayNumberOf } from "@/lib/storyCard";
import type { DayFile } from "@/lib/api/v2/store";

/**
 * `storyCardFacts` — B2665. The pure function that decides every word a
 * story card or the video's panel carries, kept separate from the
 * `ImageResponse` layout so it can be asserted on without decoding a PNG.
 * Every string is either the day's own (title, location, a photo's own
 * caption) or a derived position ("Day N", a formatted date) — nothing is
 * composed here.
 */
function baseDay(overrides: Partial<DayFile> = {}): DayFile {
  return {
    slug: "a-day",
    title: "Up the Narrows",
    date: "2025-09-06",
    content: "Something happened.",
    status: "published",
    location: "Zion National Park",
    media: [
      { src: "/media/parks-2025/zion-narrows/01.jpg", type: "image", caption: "The water going over" },
      { src: "/media/parks-2025/zion-narrows/02.jpg", type: "image" },
    ],
    weather: { tempMin: 13.1, tempMax: 24.5, source: "open-meteo", recordedAt: "2026-09-06T08:32:18.968Z" },
    ...overrides,
  } as DayFile;
}

describe("storyCardFacts", () => {
  test("carries the day's own title, place and rounded temperature range", () => {
    const facts = storyCardFacts({ day: baseDay(), dayNumber: 2, tripTitle: "Eighteen days", link: null, locale: "en" });
    expect(facts.title).toBe("Up the Narrows");
    expect(facts.place).toBe("Zion National Park");
    expect(facts.tempLine).toBe("13–25 °C");
    expect(facts.dayLabel).toBe("Day 2");
    expect(facts.tripTitle).toBe("Eighteen days");
  });

  test("omits the temperature line when the day has no weather reading", () => {
    const facts = storyCardFacts({ day: baseDay({ weather: undefined }), dayNumber: 1, tripTitle: "T", link: null, locale: "en" });
    expect(facts.tempLine).toBeUndefined();
  });

  test("omits the temperature line for a day that only asked (weather: true)", () => {
    const facts = storyCardFacts({ day: baseDay({ weather: true }), dayNumber: 1, tripTitle: "T", link: null, locale: "en" });
    expect(facts.tempLine).toBeUndefined();
  });

  test("omits the place when the day has none", () => {
    const facts = storyCardFacts({ day: baseDay({ location: undefined }), dayNumber: 1, tripTitle: "T", link: null, locale: "en" });
    expect(facts.place).toBeUndefined();
  });

  test("omits Day N when the caller could not place the day (dayNumber null)", () => {
    const facts = storyCardFacts({ day: baseDay(), dayNumber: null, tripTitle: "T", link: null, locale: "en" });
    expect(facts.dayLabel).toBeUndefined();
  });

  test("carries the link only when the caller decided to pass one — never on its own", () => {
    const withLink = storyCardFacts({ day: baseDay(), dayNumber: 1, tripTitle: "T", link: "https://t.test/@a/trips/x/day/y", locale: "en" });
    expect(withLink.link).toBe("https://t.test/@a/trips/x/day/y");
    const withoutLink = storyCardFacts({ day: baseDay(), dayNumber: 1, tripTitle: "T", link: null, locale: "en" });
    expect(withoutLink.link).toBeUndefined();
  });

  test("carries each photo's own caption, or none, and drops a video item", () => {
    const facts = storyCardFacts({
      day: baseDay({
        media: [
          { src: "/media/t/d/01.jpg", type: "image", caption: "A caption" },
          { src: "/media/t/d/02.jpg", type: "image" },
          { src: "/media/t/d/clip.mp4", type: "video", poster: "/media/t/d/clip-poster.jpg" },
        ],
      }),
      dayNumber: 1,
      tripTitle: "T",
      link: null,
      locale: "en",
    });
    expect(facts.photos).toEqual([
      { src: "/media/t/d/01.jpg", caption: "A caption" },
      { src: "/media/t/d/02.jpg", caption: undefined },
    ]);
  });
});

describe("dayNumberOf", () => {
  test("is 1-based, by position among the trip's own sorted day stems", () => {
    const stems = ["2025-09-05-a", "2025-09-06-b", "2025-09-07-c"];
    expect(dayNumberOf(stems, "2025-09-05-a")).toBe(1);
    expect(dayNumberOf(stems, "2025-09-06-b")).toBe(2);
    expect(dayNumberOf(stems, "2025-09-07-c")).toBe(3);
  });

  test("is null for a stem that is not among them, rather than a wrong number", () => {
    expect(dayNumberOf(["2025-09-05-a"], "2099-01-01-nope")).toBeNull();
  });
});

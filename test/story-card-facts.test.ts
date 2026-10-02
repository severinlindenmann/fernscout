import { describe, expect, test } from "vitest";
import { storyCardFacts, storyCaption, storyDayLink, storyPhotos } from "@/lib/storyCard";
import { segmentLine, segmentStarts, withRenderSlot } from "@/lib/storyVideo";
import type { Trip } from "@/lib/types";
import type { DayFile } from "@/lib/api/v2/documents";

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

describe("storyCardFacts — headline and sub-line fallback (B2665 round 2)", () => {
  test("an untitled day's headline is its own place; the sub-line drops the place and keeps only the temperature", () => {
    const facts = storyCardFacts({ day: baseDay({ title: "" }), dayNumber: 1, tripTitle: "Eighteen days", link: null, locale: "en" });
    expect(facts.headline).toBe("Zion National Park");
    expect(facts.subLine).toBe("13–25 °C");
  });

  test("an untitled day with no place falls back to the trip's own title", () => {
    const facts = storyCardFacts({
      day: baseDay({ title: "", location: undefined, weather: undefined }),
      dayNumber: 1,
      tripTitle: "Eighteen days",
      link: null,
      locale: "en",
    });
    expect(facts.headline).toBe("Eighteen days");
    expect(facts.subLine).toBeUndefined();
  });

  test("a titled day keeps its own place on the sub-line, with the temperature", () => {
    const facts = storyCardFacts({ day: baseDay(), dayNumber: 1, tripTitle: "T", link: null, locale: "en" });
    expect(facts.headline).toBe("Up the Narrows");
    expect(facts.subLine).toBe("Zion National Park · 13–25 °C");
  });
});

describe("storyDayLink — B2665", () => {
  const trip = (visibility: string) => ({ visibility }) as unknown as Trip;

  test("a public trip's published day gets its own /trips/ address", () => {
    expect(storyDayLink("alex", "parks-2025", "2025-09-06-zion-narrows", trip("public"), baseDay())).toMatch(
      /\/@alex\/trips\/parks-2025\/day\/2025-09-06-zion-narrows$/,
    );
  });

  test("no link for a guest or private trip, a draft, or a day held back by its own label", () => {
    expect(storyDayLink("alex", "t", "d", trip("guest"), baseDay())).toBeNull();
    expect(storyDayLink("alex", "t", "d", trip("private"), baseDay())).toBeNull();
    expect(storyDayLink("alex", "t", "d", trip("public"), baseDay({ status: "draft" }))).toBeNull();
    expect(storyDayLink("alex", "t", "d", trip("public"), baseDay({ visibility: "guest" } as Partial<DayFile>))).toBeNull();
    expect(storyDayLink("alex", "t", "d", undefined, baseDay())).toBeNull();
  });
});

describe("storyPhotos — B2665", () => {
  test("leaves out clips and any photo the owner held back with its own label", () => {
    const day = baseDay({
      media: [
        { src: "/media/t/d/01.jpg", type: "image" },
        { src: "/media/t/d/02.jpg", type: "image", visibility: "guest" },
        { src: "/media/t/d/03.mp4", type: "video" },
      ],
    } as Partial<DayFile>);
    expect(storyPhotos(day).map((m) => m.src)).toEqual(["/media/t/d/01.jpg"]);
  });
});

describe("video segments — B2665", () => {
  const segments = [
    { file: "a.jpg", caption: "The water going over" },
    { file: "b.jpg", caption: "Steps down into the fog" },
    { file: "c.jpg" },
  ];

  test("with captions on, each photo shows its own caption; the last gives its line to the link", () => {
    expect(segmentLine(segments, 0, "https://t.test/@a/trips/x/day/y", true)).toBe("The water going over");
    expect(segmentLine(segments, 1, "https://t.test/@a/trips/x/day/y", true)).toBe("Steps down into the fog");
    expect(segmentLine(segments, 2, "https://t.test/@a/trips/x/day/y", true)).toBe("t.test/@a/trips/x/day/y");
  });

  test("without a link, with captions on, the last photo keeps its own caption, or nothing", () => {
    expect(segmentLine(segments, 2, undefined, true)).toBeUndefined();
    expect(segmentLine([{ file: "a.jpg", caption: "Only one" }], 0, undefined, true)).toBe("Only one");
  });

  test("with captions off, every non-last line is empty; the last still carries the link", () => {
    expect(segmentLine(segments, 0, "https://t.test/@a/trips/x/day/y", false)).toBeUndefined();
    expect(segmentLine(segments, 1, "https://t.test/@a/trips/x/day/y", false)).toBeUndefined();
    expect(segmentLine(segments, 2, "https://t.test/@a/trips/x/day/y", false)).toBe("t.test/@a/trips/x/day/y");
    expect(segmentLine(segments, 2, undefined, false)).toBeUndefined();
  });

  test("the line switches halfway through each crossfade", () => {
    expect(segmentStarts(3, 2.8, 0.4).map((t) => Number(t.toFixed(2)))).toEqual([0, 2.6, 5.0]);
  });
});

describe("storyCaption — B2677 bug 16, reworked B2665 round 2", () => {
  const day = (title: string, content: string) => ({ title, content });

  test("joins the title as a sentence with the day's own first sentence", () => {
    expect(storyCaption(day("Up the Narrows", "Walked along the river to Belém. Then home."))).toBe(
      "Up the Narrows. Walked along the river to Belém.",
    );
  });
  test("an untitled day opens with the first sentence, never a bare '.'", () => {
    expect(storyCaption(day("", "Walked along the river to Belém."))).toBe("Walked along the river to Belém.");
  });
  test("a title already ending in punctuation is not given a second one", () => {
    expect(storyCaption(day("Up the Narrows!", "It rained."))).toBe("Up the Narrows! It rained.");
  });
  test("no words at all is an empty caption, never invented", () => {
    expect(storyCaption(day("", ""))).toBe("");
  });
  test("a title of punctuation only contributes nothing, same as no title", () => {
    expect(storyCaption(day(".", "It rained."))).toBe("It rained.");
    expect(storyCaption(day("…", "It rained."))).toBe("It rained.");
  });
  test("content that is only punctuation yields nothing, never a bare '.' or '…'", () => {
    expect(storyCaption(day("", "."))).toBe("");
    expect(storyCaption(day("", "…"))).toBe("");
  });
  test("a sentence with no terminal punctuation is kept whole, not dropped", () => {
    expect(storyCaption(day("", "Walked all day and never once stopped to think about it"))).toBe(
      "Walked all day and never once stopped to think about it",
    );
  });
  test("a very long run without terminal punctuation is trimmed to ~200 chars at a word boundary", () => {
    const content = `Walked ${"a".repeat(220)} along the river`;
    const result = storyCaption(day("", content));
    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain(" …");
  });
});

describe("render slots — B2665", () => {
  test("never more than two renders run at once, and every one still finishes", async () => {
    let now = 0;
    let peak = 0;
    const job = (i: number) =>
      withRenderSlot(async () => {
        now++;
        peak = Math.max(peak, now);
        await new Promise((resolve) => setTimeout(resolve, 5));
        now--;
        return i;
      });
    expect(await Promise.all([0, 1, 2, 3, 4, 5].map(job))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });
});

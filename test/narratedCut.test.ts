import { describe, expect, test } from "vitest";
import { buildNarratedCut, firstSentence } from "@/lib/narratedCut";
import type { Entry } from "@/lib/types";

function entry(overrides: Partial<Entry>): Entry {
  return {
    slug: "e",
    title: "Title",
    date: "2026-01-01",
    location: "Somewhere",
    country: "Nowhereland",
    lat: 0,
    lng: 0,
    cover: undefined,
    gallery: [],
    tags: [],
    costs: [],
    content: "",
    ...overrides,
  };
}

describe("buildNarratedCut", () => {
  test("one slide per calendar day, in order", () => {
    const slides = buildNarratedCut([
      entry({ slug: "a", date: "2026-01-01", location: "Faro" }),
      entry({ slug: "b", date: "2026-01-01", location: "Faro" }), // same day, second update
      entry({ slug: "c", date: "2026-01-02", location: "Lagos" }),
    ]);
    expect(slides.map((s) => s.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(slides[0].location).toBe("Faro");
    expect(slides[1].location).toBe("Lagos");
  });

  test("an empty trip has no slides", () => {
    expect(buildNarratedCut([])).toEqual([]);
  });

  test("prefers an entry's own cover over any heuristic", () => {
    const slides = buildNarratedCut([
      entry({
        date: "2026-01-01",
        cover: "hero.jpg",
        gallery: [
          { src: "other.jpg", type: "image", width: 4000, height: 2000 },
          { src: "hero.jpg", type: "image", width: 100, height: 100 },
        ],
      }),
    ]);
    expect(slides[0].photo?.src).toBe("hero.jpg");
  });

  test("a cover pointing outside the gallery is still trusted as a photo", () => {
    const slides = buildNarratedCut([
      entry({ date: "2026-01-01", cover: "somewhere/hero.jpg", gallery: [] }),
    ]);
    expect(slides[0].photo).toEqual({ src: "somewhere/hero.jpg", type: "image" });
  });

  test("without a cover, picks the largest landscape photo", () => {
    const slides = buildNarratedCut([
      entry({
        date: "2026-01-01",
        gallery: [
          { src: "portrait-big.jpg", type: "image", width: 1000, height: 3000 },
          { src: "landscape-small.jpg", type: "image", width: 800, height: 400 },
          { src: "landscape-big.jpg", type: "image", width: 4000, height: 2000 },
        ],
      }),
    ]);
    expect(slides[0].photo?.src).toBe("landscape-big.jpg");
  });

  test("falls back to any photo when nothing is landscape", () => {
    const slides = buildNarratedCut([
      entry({
        date: "2026-01-01",
        gallery: [{ src: "portrait.jpg", type: "image", width: 1000, height: 3000 }],
      }),
    ]);
    expect(slides[0].photo?.src).toBe("portrait.jpg");
  });

  test("without dimension data, falls back to the first photo of the day", () => {
    const slides = buildNarratedCut([
      entry({
        date: "2026-01-01",
        gallery: [
          { src: "first.jpg", type: "image" },
          { src: "second.jpg", type: "image" },
        ],
      }),
    ]);
    expect(slides[0].photo?.src).toBe("first.jpg");
  });

  test("a day with only video, or no gallery, has no photo", () => {
    const [videoOnly] = buildNarratedCut([
      entry({ date: "2026-01-01", gallery: [{ src: "clip.mp4", type: "video" }] }),
    ]);
    expect(videoOnly.photo).toBeUndefined();

    const [noGallery] = buildNarratedCut([entry({ date: "2026-01-01", gallery: [] })]);
    expect(noGallery.photo).toBeUndefined();
  });

  test("a photo is drawn from any entry of the day, not just the lead", () => {
    const slides = buildNarratedCut([
      entry({ slug: "a", date: "2026-01-01", gallery: [] }),
      entry({
        slug: "b",
        date: "2026-01-01",
        gallery: [{ src: "later.jpg", type: "image", width: 10, height: 5 }],
      }),
    ]);
    expect(slides[0].photo?.src).toBe("later.jpg");
    // the slide still narrates from the day's *lead* entry
    expect(slides[0].entry.slug).toBe("a");
  });
});

describe("firstSentence", () => {
  test("takes just the first sentence", () => {
    expect(firstSentence("We arrived late. The hotel was already asleep.")).toBe(
      "We arrived late.",
    );
  });

  test("keeps the whole thing when there's no terminal punctuation", () => {
    expect(firstSentence("A long day with no full stop anywhere in sight")).toBe(
      "A long day with no full stop anywhere in sight",
    );
  });

  test("strips markdown syntax", () => {
    expect(firstSentence("**Faro** was _lovely_ in the `morning` light.")).toBe(
      "Faro was lovely in the morning light.",
    );
  });

  test("keeps a link's label, drops its target", () => {
    expect(firstSentence("We ate at [the market](https://example.com/market) first.")).toBe(
      "We ate at the market first.",
    );
  });

  test("drops images entirely, keeping their alt text", () => {
    expect(firstSentence("![a rooftop view](rooftop.jpg) Best sunset yet.")).toBe(
      "a rooftop view Best sunset yet.",
    );
  });

  test("empty content yields an empty sentence", () => {
    expect(firstSentence("")).toBe("");
    expect(firstSentence("   ")).toBe("");
  });

  test("a heading with no punctuation is returned whole", () => {
    expect(firstSentence("# Day one\n\nIt began early")).toBe("Day one It began early");
  });
});

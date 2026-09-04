import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import GalleryGrid from "@/components/GalleryGrid";
import { dictionaryFor } from "@/lib/locales";
import type { MediaTile } from "@/lib/types";

/**
 * The gallery's filter row, on a journal whose days do not all name a place.
 *
 * B337: `location:` is optional on an entry, so a day written without one
 * reaches `MediaTile` as `""`. That empty string went through `new Set(…)`
 * into the chip list and rendered as a blank, clickable pill — the only way
 * to select those photographs, and unlabelled, so finding out what it did
 * meant pressing it.
 */

function tile(location: string, n: number): MediaTile {
  return {
    src: `/alex/media/alps-2024/day-${n}/01.jpg`,
    type: "image",
    location,
    country: location ? "Switzerland" : "",
    date: "2026-08-0" + n,
  };
}

function chips(media: MediaTile[]) {
  const html = renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <GalleryGrid media={media} />
    </LocaleProvider>,
  );
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
}

describe("gallery filter chips", () => {
  test("a day with no location contributes no chip", () => {
    const labels = chips([tile("Zermatt", 1), tile("", 2), tile("", 3)]);

    expect(labels).toContain("Zermatt");
    expect(labels.filter((l) => l === "")).toHaveLength(0);
  });

  test("its photographs are still counted by All", () => {
    // The blank chip goes; the photographs behind it do not. Three tiles, two
    // of them unlocated, and `All` still says three.
    const labels = chips([tile("Zermatt", 1), tile("", 2), tile("", 3)]);

    expect(labels).toContain("All (3)");
  });

  test("a trip where every day names a place is unchanged", () => {
    const labels = chips([tile("Zermatt", 1), tile("Bern", 2), tile("Zermatt", 3)]);

    expect(labels).toContain("Zermatt");
    expect(labels).toContain("Bern");
    expect(labels).toContain("All (3)");
  });
});

import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { renderPreview } from "@/lib/photobook/preview";

function photo(file: string): BookPhoto {
  return { file, width: 4000, height: 3000 };
}

function day(index: number): BookDay {
  return {
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: "Thailand",
    countryCode: "TH",
    lat: 13.7,
    lng: 100.5,
    paragraphs: ["A short day."],
    photos: [photo(`p${index}.jpg`)],
  };
}

const SOURCE: BookSource = {
  trip: {
    id: "test-trip",
    title: "A test trip",
    tagline: "Somewhere and back",
    start: "2026-01-01",
    end: "2026-01-03",
    intro: "The plan was simple.",
  },
  travellers: ["A"],
  days: [day(0), day(1), day(2)],
  route: [],
  madeOn: "2026-12-24",
  siteUrl: "https://example.test",
};

const BOOK = planBook(SOURCE, defaultSpec());

// Gallery `src` values arrive already owner-prefixed (lib/entries.ts passes
// every one through `mediaWithOwner`), so a real `webSrc` looks like
// `/alex/media/<trip>/<day>/<file>` — a complete path, used as-is and never
// re-prefixed. The fixture below stands in for that shape.
function webSrcFor(photo: BookPhoto): string {
  return `/alex/media/asia-2026/day-one/${photo.file}`;
}

describe("the preview's image sources", () => {
  test("srcFor replaces every img src and changes nothing else", () => {
    const relative = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    const web = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`, webSrcFor);

    expect(web).toContain('src="/alex/media/asia-2026/day-one/p0.jpg"');
    expect(web).not.toContain('src="p0.jpg"');
    // Strip both files' src attributes: what is left must be identical, which
    // is how we know the layout did not move.
    const strip = (html: string) => html.replace(/src="[^"]*"/g, 'src="X"');
    expect(strip(web)).toBe(strip(relative));
  });

  test("without srcFor the output is the relative-path form the CLI writes", () => {
    const html = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    expect(html).toContain('src="p0.jpg"');
  });
});

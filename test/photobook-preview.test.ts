import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { renderPreview, spreadsOf } from "@/lib/photobook/preview";

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
  figures: [],
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

describe("spreadsOf", () => {
  test("page one is alone; the rest pair 2-3, 4-5, ...", () => {
    expect(spreadsOf([1, 2, 3, 4, 5])).toEqual([[1], [2, 3], [4, 5]]);
  });

  test("an odd total does not lose the last page — it sits alone", () => {
    expect(spreadsOf([1, 2, 3, 4])).toEqual([[1], [2, 3], [4]]);
  });

  test("a single-page volume is just that page, alone", () => {
    expect(spreadsOf([1])).toEqual([[1]]);
  });

  test("no pages, no groups", () => {
    expect(spreadsOf([])).toEqual([]);
  });
});

describe("the preview's spread view", () => {
  test("every page still appears, none dropped by grouping", () => {
    const html = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    const total = BOOK.volumes.reduce((n, v) => n + v.pages.length, 0);
    expect((html.match(/<figure class="page/g) ?? []).length).toBe(total);
    // The last page's own figcaption must be present — the acceptance case an
    // off-by-one in the chunking would silently drop.
    const lastVolume = BOOK.volumes[BOOK.volumes.length - 1];
    const lastPage = lastVolume.pages[lastVolume.pages.length - 1];
    expect(html).toContain(`>${lastPage.number} ·`);
  });

  test("page one is wrapped in its own solo spread, not paired", () => {
    const html = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    // `.indexOf("spread")` would also match the outer `.spreads` container,
    // so anchor on the exact wrapper class instead.
    const start = html.search(/<div class="spread( solo)?">/);
    expect(html.startsWith('<div class="spread solo">', start)).toBe(true);
    // The next spread group starts only after exactly one figure — page one
    // holds the group alone.
    const nextGroup = html.slice(start + 1).search(/<div class="spread( solo)?">/) + start + 1;
    const soloBody = html.slice(start, nextGroup);
    expect((soloBody.match(/<figure/g) ?? []).length).toBe(1);
  });

  test("the single-page view is still available via a toggle", () => {
    const html = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    expect(html).toContain('id="view-toggle"');
    expect(html).toContain('data-view="pages"');
    expect(html).toContain('data-view="spreads"');
  });
});

describe("the map names its stops", () => {
  // B519. The printed map has always labelled them; this one did not, so
  // reading a spread to check the map could not answer "which stop is that?".
  const withRoute = planBook(
    {
      ...SOURCE,
      route: [
        { location: "Las Vegas", country: "United States", lat: 36.17, lng: -115.14 },
        { location: "Zion National Park", country: "United States", lat: 37.3, lng: -113.03 },
        { location: "Denver", country: "United States", lat: 39.74, lng: -104.99 },
      ],
    },
    defaultSpec(),
  );

  test("every stop that lands on a page is named on it", () => {
    const html = renderPreview(withRoute, "/tmp/out", (file) => `/tmp/out/${file}`);
    for (const stop of ["Las Vegas", "Zion National Park", "Denver"]) {
      expect(html, stop).toContain(stop);
    }
  });

  test("a name is never printed outside the page it belongs to", () => {
    const html = renderPreview(withRoute, "/tmp/out", (file) => `/tmp/out/${file}`);
    // Every label's x sits inside the sheet's own box. A negative x, or one
    // past the trim, is the fault this rule exists to prevent — it is what
    // printed "onal Park" against the fold on paper.
    for (const match of html.matchAll(/class="stopname"[^>]*x="(-?[\d.]+)"/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(0);
    }
    for (const match of html.matchAll(/<text x="(-?[\d.]+)"[^>]*class="stopname"/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(0);
    }
  });
});

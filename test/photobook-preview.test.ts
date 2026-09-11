import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { captionsFor } from "@/lib/photobook/captions";
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

/**
 * The composer's own copy of the preview — B548/B549.
 *
 * Everything asserted here was on the screen of somebody who had just been
 * asked for money: warning codes as headings, a constant from
 * `lib/photobook/spec.ts`, the paths of files under `content/`, a bleed and a
 * DPI target. The CLI's copy keeps all of it, and the second half of this
 * test is what stops "clean it up" from quietly meaning "delete it".
 */
describe("the bare preview", () => {
  const book = planBook(SOURCE, defaultSpec());
  const bare = renderPreview(book, "", (f) => f, undefined, { bare: true });
  const full = renderPreview(book, "");

  test("shows no code, no repository symbol and no print jargon", () => {
    for (const leak of ["<code>", "SADDLE_STITCH", "lib/", "DPI target", "mm bleed", "warning(s)", "volume(s)", "spine "]) {
      expect(bare, leak).not.toContain(leak);
    }
  });

  test("still renders every spread, and marks them drillable", () => {
    expect(bare).toContain('class="bare"');
    expect((bare.match(/class="spread/g) ?? []).length).toBe(
      (full.match(/class="spread/g) ?? []).length,
    );
    expect(bare).toContain("fernscout-photobook-preview");
  });

  test("leaves the technician's page alone", () => {
    expect(full).toContain("DPI target");
    expect(full).toContain("<code>");
  });
});

/**
 * B1421 — a phone reads the book one page at a time, and can pinch it.
 *
 * What a test can honestly say about a layout is which selectors carry it, so
 * that is what this checks: the rule is scoped to the reading view and to a
 * phone, and every page has the layer a pinch moves. Whether the result is
 * legible is a browser at 390px, and no assertion here stands in for that.
 */
describe("the phone-width reading view", () => {
  const bare = renderPreview(planBook(SOURCE, defaultSpec()), "", (f) => f, undefined, {
    bare: true,
  });

  test("splits the spread into single pages, and only when reading on a phone", () => {
    const block = bare.slice(bare.indexOf("@media (max-width:640px)"));
    expect(block).toContain('body.bare.read[data-view="spreads"] .spread');
    expect(block).toContain("display:contents");

    // Scoped to `.read`. The composer's strip and B534's day slice are the
    // same document without that class, and a page on its own snap stop
    // would put the dimmed "(other)" facing page of a slice on one of its
    // own — which is the regression this scoping exists to refuse.
    const phoneRules = block.slice(0, block.indexOf("</style>"));
    for (const line of phoneRules.split("\n")) {
      if (!line.includes("body.bare")) continue;
      expect(line, line.trim()).toContain("body.bare.read");
    }
  });

  test("gives every page a layer to pinch, and binds the gesture", () => {
    const pages = (bare.match(/class="page /g) ?? []).length;
    expect(pages).toBeGreaterThan(0);
    expect((bare.match(/<div class="zoom">/g) ?? []).length).toBe(pages);
    expect(bare).toContain("pointerdown");
  });

  test("does not drill into a day from the reading view", () => {
    // The tap that swaps the level underneath the reader belongs to the
    // strip. It used to be held off by pointer-events alone; a phone needs
    // those taps back for the pinch, so the listener is bound only where
    // there is no `read` class.
    expect(bare).toContain('classList.contains("read")');
    expect(bare).toMatch(/if \(!READING\) document\.querySelectorAll\("figure\[data-kind\]"\)/);
  });
});

/**
 * B562 — the caption says where the page came from.
 *
 * A stub translator rather than the real dictionary: what is being checked is
 * that each page reaches the right key with the right facts, and asserting on
 * English sentences here would make a reworded string a failing test.
 */
describe("page captions", () => {
  const t = (key: string, vars?: Record<string, string>) =>
    vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})` : key;
  const caption = captionsFor(BOOK, t as never);
  const pages = BOOK.volumes.flatMap((v) => v.pages);
  const captions = pages.map(caption);

  test("a page from a day names the day, numbered from the book's own order", () => {
    const second = pages.find((p) => p.kind === "day" && p.date === SOURCE.days[1].date)!;
    expect(caption(second)).toBe("photobook.caption.day(n=2,title=Day 2)");
    // The photographs of that day belong to it too, and say the same thing.
    const photos = pages.find((p) => p.kind === "photos" && p.date === SOURCE.days[1].date);
    if (photos) expect(caption(photos)).toBe("photobook.caption.day(n=2,title=Day 2)");
  });

  test("a page an include-switch put there names that switch", () => {
    expect(captions).toContain("photobook.caption.chapters");
  });

  test("a page with a name of its own uses it, not the switch behind it", () => {
    // The introduction is gated on `includeText` and says so in the data, but
    // "the writing" means the days' writing to whoever read that switch.
    const intro = pages.find((p) => p.kind === "intro")!;
    expect(intro.from).toBe("includeText");
    expect(caption(intro)).toBe("photobook.caption.intro");
  });

  test("no caption prints the planner's own vocabulary", () => {
    // Against the shipped English, because that is what somebody reads: the
    // ticket's complaint was the words on the page, not the keys behind them.
    const en = JSON.parse(readFileSync("site/locales/en.json", "utf8")) as Record<string, string>;
    const english = captionsFor(BOOK, (key, vars) =>
      Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), en[key]),
    );
    for (const page of pages) {
      expect(english(page)).toBeTruthy();
      expect(english(page)).not.toMatch(/full-bleed|colophon|photos\b|pair-|quad/i);
    }
  });

  test("renderPreview prints the caption it is given, with the page number", () => {
    const html = renderPreview(BOOK, "/tmp/out", (f) => f, undefined, {
      captionFor: () => "where it came from",
    });
    expect(html).toContain("<figcaption>1 · where it came from</figcaption>");
    expect(html).not.toContain("· colophon<");
  });
});

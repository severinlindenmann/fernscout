/**
 * The charts, and the one thing that must be true about them — B565.
 *
 * Everything on a chart page is drawn twice: once by `render.ts` as PDF
 * operators and once by `preview.ts` as SVG. The composer shows the second and
 * a customer receives the first, so if they disagree the composer lies about
 * the book somebody is paying for — and the disagreement is found by a person
 * holding a printed book, which is the most expensive possible place to find
 * it.
 *
 * So the load-bearing test here is not "the bar is the right length". It is
 * **both renderers put the bar in the same place**, checked mark by mark
 * against the one list of geometry `charts.ts` produced.
 */

import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPage, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec, mm } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { renderPreview } from "@/lib/photobook/preview";
import { renderVolume } from "@/lib/photobook/render";
import { niceMax, columns, type ChartShape } from "@/lib/photobook/charts";

function day(index: number, over: Partial<BookDay> = {}): BookDay {
  return {
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: "Thailand",
    countryCode: "TH",
    lat: 13.7,
    lng: 100.5,
    paragraphs: ["A short day."],
    photos: [{ file: `p${index}.jpg`, width: 4000, height: 3000 }],
    ...over,
  };
}

const DAYS = [0, 1, 2, 3, 4].map((i) =>
  day(i, i === 2 ? { transport: { mode: "car", from: "A", to: "B" } } : {}),
);

const SOURCE: BookSource = {
  trip: {
    id: "test-trip",
    title: "A test trip",
    start: "2026-01-01",
    end: "2026-01-05",
    intro: "The plan was simple.",
  },
  figures: [],
  travellers: ["A"],
  days: DAYS,
  route: [],
  madeOn: "2026-12-24",
  costs: {
    baseCurrency: "CHF",
    total: 1200,
    preparation: 300,
    onTheRoad: 900,
    perDay: 180,
    byCategory: [
      { category: "Food", amount: 500 },
      { category: "Beds", amount: 400 },
      { category: "Travel", amount: 300 },
    ],
    byCountry: [{ country: "Thailand", amount: 1200, nights: 5 }],
    budget: { total: 1500, days: 5 },
    byDay: DAYS.map((d, i) => ({ date: d.date, amount: 100 + i * 50, cumulative: 300 + i * 200 })),
    budgetCurve: DAYS.map((_, i) => 300 + (i + 1) * 240),
  },
  weather: {
    measured: 3,
    missing: 2,
    avgHigh: 28.4,
    avgLow: 19.1,
    // Two of the five days carry nothing: the gap is the point.
    byDay: [
      { date: "2026-01-01", tempMin: 18, tempMax: 27, precipitation: 0 },
      { date: "2026-01-02" },
      { date: "2026-01-03", tempMin: 20, tempMax: 30, precipitation: 12.5 },
      { date: "2026-01-04" },
      { date: "2026-01-05", tempMin: 19.3, tempMax: 28.2, precipitation: 0 },
    ],
    sources: ["Open-Meteo"],
  },
};

const SPEC = defaultSpec();
const WITH_CHARTS = { ...DEFAULT_OPTIONS, includeCharts: true };

function pagesOf(book: ReturnType<typeof planBook>): BookPage[] {
  return book.volumes.flatMap((v) => v.pages);
}

const render = (book: ReturnType<typeof planBook>) =>
  new TextDecoder("latin1").decode(
    renderVolume(book.volumes[0], SPEC, { loadImage: () => new Uint8Array() }).pdf,
  );

describe("the chart pages", () => {
  test("are off unless asked for", () => {
    const kinds = pagesOf(planBook(SOURCE, SPEC, DEFAULT_OPTIONS)).map((p) => p.kind);
    expect(kinds).not.toContain("analytics");
    expect(DEFAULT_OPTIONS.includeCharts).toBe(false);
  });

  test("switched on, the trip gets one page per subject it has data for", () => {
    const pages = pagesOf(planBook(SOURCE, SPEC, WITH_CHARTS)).filter(
      (p) => p.kind === "analytics",
    );
    expect(pages.map((p) => (p.kind === "analytics" ? p.topic : ""))).toEqual([
      "spend",
      "weather",
    ]);
    // Every one of them names the switch that put it there — B562.
    expect(pages.every((p) => p.from === "includeCharts")).toBe(true);
  });

  test("a trip with neither costs nor weather gets no chart pages, not empty ones", () => {
    const bare: BookSource = { ...SOURCE, costs: undefined, weather: undefined };
    const kinds = pagesOf(planBook(bare, SPEC, WITH_CHARTS)).map((p) => p.kind);
    expect(kinds).not.toContain("analytics");
  });

  test("only the half the trip has data for", () => {
    const noCosts = pagesOf(planBook({ ...SOURCE, costs: undefined }, SPEC, WITH_CHARTS)).filter(
      (p) => p.kind === "analytics",
    );
    expect(noCosts.map((p) => (p.kind === "analytics" ? p.topic : ""))).toEqual(["weather"]);
  });
});

describe("no weather value that did not come from weatherData", () => {
  test("a day with no reading draws no column, and nothing bridges the gap", () => {
    // Three days of the five carry a reading, so three temperature columns.
    const marks = columns(
      { x: 0, y: 0, width: 100, height: 50 },
      SOURCE.weather!.byDay.map((d) => ({
        span:
          d.tempMin !== undefined && d.tempMax !== undefined
            ? { lo: d.tempMin, hi: d.tempMax }
            : undefined,
      })),
      { min: 15, max: 35 },
    );
    expect(marks).toHaveLength(3);
    // And they stay at their own days rather than closing up.
    expect(marks.map((m) => (m.kind === "rect" ? Math.round(m.x) : -1))).toEqual([0, 40, 80]);
  });

  test("every temperature on the page is one of the readings", () => {
    const page = pagesOf(planBook(SOURCE, SPEC, WITH_CHARTS)).find(
      (p) => p.kind === "analytics" && p.topic === "weather",
    );
    const shapes = page?.kind === "analytics" ? page.shapes : [];
    const degrees = shapes
      .filter((s): s is Extract<ChartShape, { kind: "text" }> => s.kind === "text")
      .map((s) => s.text)
      .filter((t) => /^-?\d+(\.\d+)?°$/.test(t))
      .map((t) => Number(t.replace("°", "")));
    // Axis ends are rounded outward to whole fives, the averages are
    // `summariseWeather`'s own. Nothing else may appear.
    const allowed = new Set([15, 30, SOURCE.weather!.avgHigh, SOURCE.weather!.avgLow]);
    for (const value of degrees) expect(allowed.has(value)).toBe(true);
  });

  test("the archive is credited, and the missing days are owned up to", () => {
    const page = pagesOf(planBook(SOURCE, SPEC, WITH_CHARTS)).find(
      (p) => p.kind === "analytics" && p.topic === "weather",
    );
    const text = (page?.kind === "analytics" ? page.shapes : [])
      .map((s) => (s.kind === "text" ? s.text : ""))
      .join(" | ");
    expect(text).toContain("Open-Meteo");
    expect(text).toContain("2 days have no reading");
  });
});

/**
 * The one that matters.
 *
 * Every rectangle and every line on a chart page, converted from millimetres
 * exactly once — and then found, at that position, in both the PDF's operator
 * stream and the preview's SVG. A chart whose axis were computed twice would
 * fail this on the first mark.
 */
describe("the PDF and the preview draw the same geometry", () => {
  const book = planBook(SOURCE, SPEC, WITH_CHARTS);
  const pdf = render(book);
  const html = renderPreview(book, "/tmp");
  const charted = pagesOf(book).filter(
    (p) => p.kind === "costs" || p.kind === "transport" || p.kind === "analytics",
  );

  test("there are chart pages to check", () => {
    expect(charted.map((p) => p.kind).sort()).toEqual([
      "analytics",
      "analytics",
      "costs",
      "transport",
    ]);
  });

  for (const page of charted) {
    const shapes: ChartShape[] =
      page.kind === "costs" || page.kind === "transport" || page.kind === "analytics"
        ? page.shapes
        : [];
    const rects = shapes.filter(
      (s): s is Extract<ChartShape, { kind: "rect" }> => s.kind === "rect" && s.width > 0 && s.height > 0,
    );

    test(`page ${page.number} (${page.kind}) — ${rects.length} rectangles agree`, () => {
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) {
        // The PDF: trim-relative mm → points from the bleed corner.
        const pt = (v: number) => mm(SPEC.bleedMm + v).toFixed(3);
        const len = (v: number) => mm(v).toFixed(3);
        expect(pdf).toContain(`${pt(r.x)} ${pt(r.y)} ${len(r.width)} ${len(r.height)} re`);

        // The preview: the same mm, y flipped for SVG, in the same media box.
        const x = (r.x + SPEC.bleedMm).toFixed(2);
        const y = (SPEC.size.trimHeightMm + SPEC.bleedMm - (r.y + r.height)).toFixed(2);
        expect(html).toContain(
          `<rect x="${x}" y="${y}" width="${r.width.toFixed(2)}" height="${r.height.toFixed(2)}"`,
        );
      }
    });
  }

  test("and the same words, in the same places", () => {
    for (const page of charted) {
      const shapes: ChartShape[] =
        page.kind === "costs" || page.kind === "transport" || page.kind === "analytics"
          ? page.shapes
          : [];
      for (const t of shapes.filter(
        (s): s is Extract<ChartShape, { kind: "text" }> => s.kind === "text",
      )) {
        const x = (t.x + SPEC.bleedMm).toFixed(2);
        const y = (SPEC.size.trimHeightMm + SPEC.bleedMm - t.y).toFixed(2);
        expect(html).toContain(`<text xml:space="preserve" x="${x}" y="${y}"`);
        expect(pdf).toContain(`${mm(SPEC.bleedMm + t.x).toFixed(3)} ${mm(SPEC.bleedMm + t.y).toFixed(3)} Td`);
      }
    }
  });
});

describe("niceMax", () => {
  test("rounds up to a number somebody would have chosen", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(1200)).toBe(2000);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(100)).toBe(100);
  });
});

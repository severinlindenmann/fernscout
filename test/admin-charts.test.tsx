import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, CountBars, Meter, Sparkline } from "@/app/admin/Charts";
import SpendChart from "@/app/admin/SpendChart";

/**
 * B763. The charts are pure functions of their props, which is the whole
 * reason they are worth testing: the arithmetic that turns rappen into a
 * percentage is the part that is silently wrong — a bar at 3000% or at 0%
 * still typechecks, lints and renders.
 */

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("the horizontal bars", () => {
  test("the longest bar is full width and the rest are in proportion", () => {
    const out = html(
      <BarChart
        title="Where it goes"
        bars={[
          { label: "Print", rappen: 100 },
          { label: "Models", rappen: 400 },
        ]}
        empty="nothing"
      />,
    );
    expect(out).toContain("width:100%");
    expect(out).toContain("width:25%");
  });

  test("bars are ordered longest first, whatever order they arrived in", () => {
    const out = html(
      <BarChart
        title="t"
        bars={[
          { label: "Small", rappen: 1 },
          { label: "Large", rappen: 900 },
        ]}
        empty="nothing"
      />,
    );
    expect(out.indexOf("Large")).toBeLessThan(out.indexOf("Small"));
  });

  test("a line that cost nothing is left out rather than drawn as a zero bar", () => {
    const out = html(
      <BarChart title="t" bars={[{ label: "Free", rappen: 0 }]} empty="nothing here" />,
    );
    expect(out).toContain("nothing here");
    expect(out).not.toContain("Free");
  });

  /**
   * The floor. Without it a line costing a rappen against one costing fifty
   * francs renders as nothing at all, which reads as "this did not happen"
   * rather than "this was small".
   */
  test("a very small bar still draws something", () => {
    const out = html(
      <BarChart
        title="t"
        bars={[
          { label: "Tiny", rappen: 1 },
          { label: "Huge", rappen: 1_000_000 },
        ]}
        empty="nothing"
      />,
    );
    expect(out).toContain("width:2%");
  });
});

/**
 * The stacked daily chart — B996 replaced B763's single-hue one.
 *
 * Rendered here at its initial state, which is the 30-day view. A client
 * component renders perfectly well through `renderToStaticMarkup`: the
 * directive is an instruction to the bundler, not to React, and `useState`
 * simply returns its initial value.
 */
describe("the daily bars", () => {
  const days = [
    { date: "2026-09-01", rappen: 0, parts: [] },
    { date: "2026-09-02", rappen: 50, parts: [{ operation: "write_day", rappen: 50 }] },
    {
      date: "2026-09-03",
      rappen: 100,
      parts: [
        { operation: "write_day", rappen: 60 },
        { operation: "transcribe", rappen: 40 },
      ],
    },
  ];

  test("every day gets a column, including the empty ones", () => {
    const out = html(<SpendChart days={days} />);
    expect(out).toContain("height:100%");
    expect(out).toContain("height:50%");
    // The empty day is a foot rather than an absence — a chart that silently
    // drops the quiet days makes one busy afternoon look like a trend.
    expect(out).toContain("bg-cream-200");
  });

  test("a day is split by what spent it, in proportion", () => {
    const out = html(<SpendChart days={days} />);
    // 60 and 40 rappen of a 100-rappen day.
    expect(out).toContain("height:60%");
    expect(out).toContain("height:40%");
  });

  test("each column carries its own date and amount for a pointer", () => {
    const out = html(<SpendChart days={days} />);
    expect(out).toContain('title="2026-09-03');
    // The attribute, not a <title> element — the element is SVG's and would
    // render as text inside the bar.
    expect(out).not.toContain("<title>");
  });

  test("the legend names the features, not the operations", () => {
    const out = html(<SpendChart days={days} />);
    expect(out).toContain("Writing days");
    expect(out).toContain("Transcribing speech");
    expect(out).not.toContain("write_day");
  });

  test("a window where nothing happened says so instead of drawing a flat line", () => {
    const out = html(<SpendChart days={[{ date: "2026-09-01", rappen: 0, parts: [] }]} />);
    expect(out).toContain("Nothing metered");
    expect(out).not.toContain("height:");
  });
});

describe("the small marks", () => {
  test("a meter is clamped rather than overflowing its track", () => {
    expect(html(<Meter fraction={3} />)).toContain("width:100%");
    expect(html(<Meter fraction={-1} />)).toContain("width:0");
  });

  test("a measured zero draws nothing, and a small number draws a foot", () => {
    // The distinction the balance meter rests on: "spent every credit" must
    // not look the same as "spent almost all of them".
    expect(html(<Meter fraction={0} />)).toContain("width:0");
    expect(html(<Meter fraction={0.001} />)).toContain("width:2%");
  });

  test("a sparkline needs two points to be a line", () => {
    expect(html(<Sparkline points={[5]} label="one" />)).toBe("");
    expect(html(<Sparkline points={[0, 5]} label="two" />)).toContain("polyline");
  });

  test("a flat series is drawn flat rather than dropped", () => {
    const out = html(<Sparkline points={[3, 3, 3]} label="flat" />);
    expect(out).toContain("polyline");
    expect(out).toContain("2.00");
  });

  test("counts are counted, never formatted as money", () => {
    const out = html(
      <CountBars
        title="Days written"
        weeks={[
          { week: "2026-08-31", count: 2 },
          { week: "2026-09-07", count: 4 },
        ]}
        unit="days"
        empty="nothing"
      />,
    );
    expect(out).toContain("6 days");
    expect(out).not.toContain("CHF");
    expect(out).toContain("height:50%");
  });
});

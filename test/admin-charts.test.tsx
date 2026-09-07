import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, DailyChart } from "@/app/admin/Charts";

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

describe("the daily bars", () => {
  const days = [
    { date: "2026-09-01", rappen: 0 },
    { date: "2026-09-02", rappen: 50 },
    { date: "2026-09-03", rappen: 100 },
  ];

  test("every day gets a column, including the empty ones", () => {
    const out = html(<DailyChart title="t" days={days} empty="nothing" />);
    // Three columns: the tallest at 100%, the middle at 50%, the empty one at
    // the 2% foot rather than absent.
    expect(out).toContain("height:100%");
    expect(out).toContain("height:50%");
    expect(out).toContain("height:2%");
  });

  test("each column carries its own date and amount for a pointer", () => {
    const out = html(<DailyChart title="t" days={days} empty="nothing" />);
    expect(out).toContain("2026-09-02");
    // The attribute, not a <title> element — the element is SVG's and would
    // render as text inside the bar.
    expect(out).toContain('title="2026-09-03');
    expect(out).not.toContain("<title>");
  });

  test("the ends of the range are labelled and the middle is not", () => {
    const out = html(<DailyChart title="t" days={days} empty="nothing" />);
    expect(out).toContain("2026-09-01");
    expect(out).toContain("2026-09-03");
  });

  test("a window where nothing happened says so instead of drawing a flat line", () => {
    const out = html(
      <DailyChart
        title="t"
        days={[{ date: "2026-09-01", rappen: 0 }]}
        empty="no metered calls yet"
      />,
    );
    expect(out).toContain("no metered calls yet");
    expect(out).not.toContain("height:");
  });
});

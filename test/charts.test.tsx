import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList, DailyColumns, StackedShareBar } from "@/components/charts/Charts";

/**
 * A chart has to be a chart before anything runs.
 *
 * These bars used to animate their own size — `initial={{ width: 0 }}` into
 * `whileInView={{ width: "62%" }}` — which writes `width: 0` into the markup
 * and leaves it there until an IntersectionObserver fires. Anything that never
 * fires one is left with an empty box: printing, a crawler, a screenshot taken
 * before the page is scrolled that far, and a reader who has asked their
 * system for less movement, since `whileInView` is a trigger and not only a
 * duration. It was reported as "every bar renders at zero height", which from
 * outside is exactly what it is.
 *
 * The size is now in the markup and a transform does the growing. This test
 * reads the server's own HTML, which is the state everything above starts in.
 */

const money = (n: number) => `CHF ${n}`;

describe("what the server sends before any JavaScript", () => {
  test("each column carries its real height", () => {
    const html = renderToStaticMarkup(
      <DailyColumns
        data={[
          { date: "2026-01-01", amount: 50 },
          { date: "2026-01-02", amount: 100 },
        ]}
        format={money}
        formatDate={(d) => d}
        average={75}
      />,
    );
    expect(html).toContain("height:50%");
    expect(html).toContain("height:100%");
  });

  test("each row of a bar list carries its real width", () => {
    const html = renderToStaticMarkup(
      <BarList
        rows={[
          { key: "a", label: "Food", value: 40 },
          { key: "b", label: "Fuel", value: 80 },
        ]}
        format={money}
      />,
    );
    expect(html).toContain("width:50%");
    expect(html).toContain("width:100%");
  });

  test("each slice of a share bar carries its real width", () => {
    const html = renderToStaticMarkup(
      <StackedShareBar
        slices={[
          { key: "a", label: "Food", value: 25, color: "#111" },
          { key: "b", label: "Fuel", value: 75, color: "#222" },
        ]}
        format={money}
      />,
    );
    expect(html).toContain("width:25%");
    expect(html).toContain("width:75%");
  });

  /** Growing from nothing is a transform, so the geometry survives it. */
  test("the growing is a transform, never the size itself", () => {
    const html = renderToStaticMarkup(
      <DailyColumns
        data={[{ date: "2026-01-01", amount: 50 }]}
        format={money}
        formatDate={(d) => d}
        average={50}
      />,
    );
    expect(html).toContain("scaleY(0)");
    expect(html).not.toMatch(/height:\s*0(px)?[;"]/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import VisitorsContent from "@/app/[user]/studio/visitors/VisitorsContent";
import LocaleProvider from "@/components/LocaleProvider";
import type { VisitorReport } from "@/lib/analytics/report";
import { dictionaryFor } from "@/lib/locales";

/** B2095 — the day-by-day bars only once there are three days to compare;
 *  the table carries the numbers either way. */
function render(days: number): string {
  const perDay = Array.from({ length: days }, (_, i) => ({ day: `2026-09-0${i + 1}`, opens: i + 1, visitors: 1 }));
  const report: VisitorReport = {
    days: 30,
    opens: perDay.reduce((sum, d) => sum + d.opens, 0),
    visitors: days,
    perDay,
    trips: [],
    entries: [],
    kinds: [],
  };
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <VisitorsContent report={report} base="/alex" windows={[7, 30, 90]} retentionDays={90} />
    </LocaleProvider>,
  );
}

describe("the visitors chart", () => {
  test("one day renders the table and no chart", () => {
    const html = render(1);
    expect(html).not.toContain('data-testid="visitors-chart"');
    expect(html).toContain("<table");
    // B2139 — the day reads as words, never as an ISO date.
    expect(html).toContain("Tuesday, 1 September");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("three days render the chart", () => {
    expect(render(3)).toContain('data-testid="visitors-chart"');
  });

  test("How this is counted names the pages that are counted", () => {
    expect(render(1)).toContain("Not counted: the list of all your trips");
  });
});

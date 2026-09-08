import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Mapping } from "@/components/AgentInbox";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { ColumnMapping } from "@/importers/costs/mapping";

/**
 * B760 — a mapped statement never carries the `charged` pair a dedicated
 * importer's own parser can (`applyMapping` in `importers/costs/mapping.ts`
 * only ever sees one amount column), so `readStatement`'s exchange rates are
 * always empty for it. This is the only screen a mapped statement reaches, so
 * it is where that has to be said, naming the banks that do offer rates.
 */

const MAPPING: ColumnMapping = {
  date: "Date",
  amount: "Amount",
  description: "Description",
  dateFormat: "YYYY-MM-DD",
};

function render(dedicatedImporters: string[]): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <Mapping
        header={["Date", "Amount", "Description"]}
        mapping={MAPPING}
        notes={[]}
        preview={[]}
        dedicatedImporters={dedicatedImporters}
        onChange={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("a mapped statement says whether rates were on offer", () => {
  test("names the banks with their own importer", () => {
    const html = render(["Revolut consolidated statement (CSV)"]);
    expect(html).toContain("Revolut consolidated statement (CSV)");
    expect(html).toContain("only offered for statements read by a dedicated importer");
  });

  test("says nothing when there is no dedicated importer to name", () => {
    const html = render([]);
    expect(html).not.toContain("Exchange rates worked out");
  });
});

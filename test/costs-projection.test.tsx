import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePathname: () => "/alex/costs",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearLocaleCache, dictionaryFor } from "@/lib/locales";
import { getCostSummary } from "@/lib/costs";
import CostsPageContent from "@/app/[user]/(trip)/costs/CostsPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import type { SiteSummary } from "@/lib/site";

/**
 * B1521 — the budget panel projected a finished trip forward and charged the
 * average of the days that *had* a cost figure to the days that did not.
 *
 * A trip whose `status` reads as `past` (`isOver`, lib/tripTime.ts) has
 * nothing left to forecast, and a day marked `unrecorded: [costs]` is a
 * refusal to state a number, not a day that cost the going rate. Both are
 * exercised here against `getCostSummary` directly — the arithmetic — and
 * once against the rendered panel, so a fix that only touched one layer would
 * still fail this file.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-projection-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "de",
      locales: ["de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
  return dir;
}

function writeTrip(
  dir: string,
  id: string,
  trip: { start: string; end: string; status: string },
  costsFrontmatter: string,
  days: { date: string; frontmatter?: string; slug?: string }[],
): void {
  const tripDir = path.join(dir, "alex", "trips", id);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    `---\nid: ${id}\ntitle: "T"\nstart: "${trip.start}"\nend: "${trip.end}"\n` +
      `status: ${trip.status}\nvisibility: public\n---\n\nSomething.\n`,
  );
  fs.writeFileSync(path.join(tripDir, "costs.md"), costsFrontmatter);
  for (const day of days) {
    fs.writeFileSync(
      // `slug` lets two entries share one date — several updates in a day
      // is normal (lib/types.ts's `Day`), and `d` stays the default so
      // every existing call site is unaffected.
      path.join(tripDir, "entries", `${day.date}-${day.slug ?? "d"}.md`),
      `---\ntitle: "D"\ndate: "${day.date}"\n${day.frontmatter ?? ""}---\n\nA day.\n`,
    );
  }
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe("a trip that is over", () => {
  test("carries no pace and no projection, however the days were recorded", () => {
    const dir = journal();
    writeTrip(
      dir,
      "over-2025",
      { start: "2025-01-01", end: "2025-01-05", status: "past" },
      "---\nbudget:\n  total: 250\n  days: 5\n---\n\nBefore we left.\n",
      [
        { date: "2025-01-01", frontmatter: "costs:\n  - label: Food\n    amount: 100\n    category: food\n" },
        { date: "2025-01-02", frontmatter: "unrecorded: [costs]\n" },
        { date: "2025-01-03", frontmatter: "costs:\n  - label: Food\n    amount: 100\n    category: food\n" },
        { date: "2025-01-04", frontmatter: "unrecorded: [costs]\n" },
      ],
    );

    const summary = getCostSummary("alex/over-2025");
    expect(summary.isOver).toBe(true);
    expect(summary.hasBegun).toBe(true);
    // The plain facts are still there…
    expect(summary.budget).toMatchObject({ total: 250, days: 5, perDay: 50, remaining: 50 });
    // …but nothing forward-looking is attached to them.
    expect(summary.budget?.pace).toBeUndefined();
  });

  test("the rendered panel says so in past tense, with no 'für heute' line and no Hochgerechnet figure", () => {
    const dir = journal();
    writeTrip(
      dir,
      "over-2025",
      { start: "2025-01-01", end: "2025-01-05", status: "past" },
      "---\nbudget:\n  total: 250\n  days: 5\n---\n\nBefore we left.\n",
      [
        { date: "2025-01-01", frontmatter: "costs:\n  - label: Food\n    amount: 300\n    category: food\n" },
      ],
    );
    const summary = getCostSummary("alex/over-2025");
    const site = {
      username: "alex",
      title: "A journal",
      tagline: "t",
      url: "https://example.test",
      startLocation: "X",
      baseCurrency: "CHF",
      locales: ["de"],
      base: "/alex",
      hasAccessPanel: false,
    } as unknown as SiteSummary;
    const html = renderToStaticMarkup(
      <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <CostsPageContent summary={summary} travellers="A" />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
    const dict = dictionaryFor("de");
    expect(html).not.toContain(dict["cost.paceMark"].split(":")[0]); // "Geplanter Stand für heute"
    expect(html).not.toContain("Hochgerechnet");
    expect(html).toContain(dict["cost.overBudgetFinal"]);
    expect(html).toContain(dict["cost.budgetNoteFinal"]);
  });
});

describe("a trip that is still running", () => {
  test("projects only from the days that have an answer, and says how many", () => {
    const dir = journal();
    writeTrip(
      dir,
      "run-2026",
      { start: "2026-09-01", end: "2026-09-20", status: "current" },
      "---\nbudget:\n  total: 1000\n  days: 20\n---\n\nBefore we left.\n",
      [
        // Two recorded days at 90, one genuinely spend-free day (`without`,
        // a real zero — must still count as an answer), and two days nobody
        // wrote down (`unrecorded` — must never be averaged in).
        { date: "2026-09-01", frontmatter: "costs:\n  - label: Food\n    amount: 90\n    category: food\n" },
        { date: "2026-09-02", frontmatter: "unrecorded: [costs]\n" },
        { date: "2026-09-03", frontmatter: "costs:\n  - label: Food\n    amount: 90\n    category: food\n" },
        { date: "2026-09-04", frontmatter: "unrecorded: [costs]\n" },
        { date: "2026-09-05", frontmatter: "without: [costs]\n" },
      ],
    );

    const summary = getCostSummary("alex/run-2026", new Date("2026-09-06T12:00:00Z"));
    expect(summary.isOver).toBe(false);
    expect(summary.unrecordedDays).toBe(2);
    // The old bug's denominator — days with amount > 0 — undercounts the
    // real zero day; the fixed one (recorded days: everything but
    // `unrecorded`) does not.
    expect(summary.daysWithSpend).toBe(2);
    expect(summary.perDay).toBe(60); // 180 / 3 recorded days, not 180 / 2

    const pace = summary.budget?.pace;
    expect(pace).toBeDefined();
    expect(pace?.projectedFromDays).toBe(3);
    // 60/day average over 3 recorded days, projected across all 20 planned —
    // never the 5 elapsed days including the 2 unrecorded ones.
    expect(pace?.projectedTotal).toBe(1200);
  });

  test("shows no projection at all once most of the elapsed days are unrecorded", () => {
    const dir = journal();
    writeTrip(
      dir,
      "quiet-2026",
      { start: "2026-09-01", end: "2026-09-20", status: "current" },
      "---\nbudget:\n  total: 1000\n  days: 20\n---\n\nBefore we left.\n",
      [
        { date: "2026-09-01", frontmatter: "unrecorded: [costs]\n" },
        { date: "2026-09-02", frontmatter: "unrecorded: [costs]\n" },
        { date: "2026-09-03", frontmatter: "costs:\n  - label: Food\n    amount: 50\n    category: food\n" },
      ],
    );
    const summary = getCostSummary("alex/quiet-2026", new Date("2026-09-04T12:00:00Z"));
    expect(summary.isOver).toBe(false);
    const pace = summary.budget?.pace;
    // The bar and the "so far" delta still mean something…
    expect(pace).toBeDefined();
    // …but a franc figure built mostly from a guess is not shown at all.
    expect(pace?.projectedTotal).toBeUndefined();
    expect(pace?.projectedFromDays).toBe(1);
  });

  test("every day unrecorded: no projection at all", () => {
    const dir = journal();
    writeTrip(
      dir,
      "silent-2026",
      { start: "2026-09-01", end: "2026-09-20", status: "current" },
      "---\nbudget:\n  total: 1000\n  days: 20\n---\n\nBefore we left.\n",
      [
        { date: "2026-09-01", frontmatter: "unrecorded: [costs]\n" },
        { date: "2026-09-02", frontmatter: "unrecorded: [costs]\n" },
      ],
    );
    const summary = getCostSummary("alex/silent-2026", new Date("2026-09-03T12:00:00Z"));
    expect(summary.budget?.pace?.projectedTotal).toBeUndefined();
    expect(summary.budget?.pace?.projectedFromDays).toBe(0);
  });
});

/**
 * B1629 — "nothing was spent" was never a decline.
 *
 * A day was misread as excluded-from-the-average (`unrecorded`) whenever
 * *any* decline marker for `costs` was present, which conflated two
 * different facts: `without: [costs]` ("there was no money on this day" —
 * a real zero, and a real data point) and `unrecorded: [costs]` ("money
 * was spent and the figures are gone" — no data point at all). The correct
 * rule branches on whether the day actually carries a recorded figure
 * (a non-empty items array, `amount > 0`) rather than on which decline was
 * written: a real zero pulls the average down, and only a day with no
 * recorded figure at all is excluded.
 */
describe("B1629 — zero-spend vs figures-lost", () => {
  test("a genuine zero-spend day (`without: [costs]`) pulls the average down, never excluded", () => {
    const dir = journal();
    writeTrip(
      dir,
      "frugal-2026",
      { start: "2026-09-01", end: "2026-09-04", status: "current" },
      "---\nbudget:\n  total: 100\n  days: 4\n---\n\nBefore we left.\n",
      [
        { date: "2026-09-01", frontmatter: "costs:\n  - label: Food\n    amount: 30\n    category: food\n" },
        // Two frugal days in a row, genuinely spend-free.
        { date: "2026-09-02", frontmatter: "without: [costs]\n" },
        { date: "2026-09-03", frontmatter: "without: [costs]\n" },
      ],
    );

    const summary = getCostSummary("alex/frugal-2026", new Date("2026-09-04T12:00:00Z"));
    expect(summary.unrecordedDays).toBe(0);
    // 30 across 3 recorded days — the two zero-spend days count in the
    // denominator and pull the average down, not out of it.
    expect(summary.perDay).toBe(10);
    expect(summary.byDay.map((d) => d.unrecorded)).toEqual([false, false, false]);
  });

  test("a day whose figures are lost (`unrecorded: [costs]`) is excluded, and never charged a zero", () => {
    const dir = journal();
    writeTrip(
      dir,
      "gap-2026",
      { start: "2026-09-01", end: "2026-09-04", status: "current" },
      "---\nbudget:\n  total: 100\n  days: 4\n---\n\nBefore we left.\n",
      [
        { date: "2026-09-01", frontmatter: "costs:\n  - label: Food\n    amount: 30\n    category: food\n" },
        { date: "2026-09-02", frontmatter: "unrecorded: [costs]\n" },
      ],
    );

    const summary = getCostSummary("alex/gap-2026", new Date("2026-09-03T12:00:00Z"));
    expect(summary.unrecordedDays).toBe(1);
    // 30 over the 1 recorded day only — the lost day neither adds a zero
    // nor gets averaged over.
    expect(summary.perDay).toBe(30);
  });

  test("real recorded spend outranks a stale decline marker for the same day", () => {
    const dir = journal();
    writeTrip(
      dir,
      "mixed-2026",
      { start: "2026-09-01", end: "2026-09-02", status: "current" },
      "---\nbudget:\n  total: 100\n  days: 2\n---\n\nBefore we left.\n",
      [
        // Two updates on the same day: one records a real figure, the
        // other still carries an `unrecorded` marker from before the
        // figure was found. The day has an answer — it must count as one.
        { date: "2026-09-01", slug: "a", frontmatter: "costs:\n  - label: Food\n    amount: 40\n    category: food\n" },
        { date: "2026-09-01", slug: "b", frontmatter: "unrecorded: [costs]\n" },
      ],
    );

    const summary = getCostSummary("alex/mixed-2026", new Date("2026-09-02T12:00:00Z"));
    expect(summary.unrecordedDays).toBe(0);
    expect(summary.byDay).toEqual([{ date: "2026-09-01", amount: 40, cumulative: 40, unrecorded: false }]);
  });
});

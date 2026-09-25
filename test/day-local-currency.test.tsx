import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
import TripStory from "@/app/TripStory";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripListProvider from "@/components/TripListProvider";
import TripProvider from "@/components/TripProvider";
import { createDraft, publishDraft } from "@/lib/api/entries";
import { clearConfigCache } from "@/lib/config";
import { costLocalForDay } from "@/lib/costs";
import { getAllEntries } from "@/lib/entries";
import { dictionaryFor } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { buildStoryProps, type ViewerOptions } from "@/lib/tripView";
import { createTrip } from "@/lib/tripWrite";
import { getTrips } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";

/**
 * B544 — a day shows what it cost as actually paid, not only converted.
 *
 * `bangkok-2026` here logs one day entirely in THB (a single foreign
 * currency, `costLocal` applies), one day split between THB and EUR (mixed,
 * `costLocal` stays absent — summing two currencies into one "local" figure
 * would be a fabricated total), and one day in the trip's own base currency
 * (nothing to add beside the converted total).
 */

let dir: string;
const REF = "alex/bangkok-2026";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-local-currency-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { costs: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const made = createTrip("alex", {
    id: "bangkok-2026",
    title: "Bangkok",
    start: "2026-06-01",
    end: "2026-06-10",
    status: "current",
    visibility: "public",
    costsVisibility: "guests",
    rates: { THB: 0.026, EUR: 0.96 },
  });
  if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

  // Day one: every cost in THB, and not the base — costLocal applies.
  const day1 = createDraft(REF, {
    title: "Arrival",
    date: "2026-06-01",
    location: "Bangkok",
    country: "Thailand",
    content: "Landed.",
    costs: [{ label: "Taxi", amount: 400, currency: "THB", category: "transport" }],
  });
  if (!day1.ok) throw new Error(`could not write day1: ${day1.error}`);
  const day1b = createDraft(REF, {
    title: "Dinner",
    date: "2026-06-01",
    location: "Bangkok",
    country: "Thailand",
    content: "Ate.",
    costs: [{ label: "Noodles", amount: 120, currency: "THB", category: "food" }],
  });
  if (!day1b.ok) throw new Error(`could not write day1b: ${day1b.error}`);

  // Day two: THB and EUR both logged — mixed, costLocal must stay absent.
  const day2 = createDraft(REF, {
    title: "Border run",
    date: "2026-06-02",
    location: "Aranyaprathet",
    country: "Thailand",
    content: "Crossed over.",
    costs: [
      { label: "Bus", amount: 200, currency: "THB", category: "transport" },
      { label: "Visa run fee", amount: 5, currency: "EUR", category: "other" },
    ],
  });
  if (!day2.ok) throw new Error(`could not write day2: ${day2.error}`);

  // Day three: logged in the base currency — nothing to add beside the total.
  const day3 = createDraft(REF, {
    title: "Home stretch",
    date: "2026-06-03",
    location: "Bangkok",
    country: "Thailand",
    content: "Back in town.",
    costs: [{ label: "Hostel", amount: 30, currency: "CHF", category: "accommodation" }],
  });
  if (!day3.ok) throw new Error(`could not write day3: ${day3.error}`);

  for (const d of [day1, day1b, day2, day3]) {
    if (!d.ok) continue;
    const published = publishDraft(REF, d.slug);
    if (!published.ok) throw new Error(`could not publish ${d.slug}: ${published.error}`);
  }
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Everything from `<main id="main"` onward — the day card actually open,
 * without the desktop sidebar's own list of every day (`GamePath`), which
 * since B554 shows its own ≈-marked figure per day regardless of which one
 * is open. */
function mainOnly(html: string): string {
  const i = html.indexOf('<main id="main"');
  return i < 0 ? html : html.slice(i);
}

function render(
  viewer: ViewerOptions = {},
  openAt = "2026-06-01",
): { html: string; props: ReturnType<typeof buildStoryProps> } {
  // Open on a specific day rather than the trip's overview, which is where a
  // reload lands by default and shows no day card at all — and the pager
  // shows one step at a time, so only the opened day's own figures appear.
  const props = buildStoryProps(REF, { openAt, ...viewer });
  const site = siteSummary("alex", true);
  if (!site) throw new Error("no site");
  const trips = getTrips("alex").map((t) => ({
    id: t.id,
    ref: t.ref,
    username: t.username,
    title: t.title,
    start: t.start,
    end: t.end,
    status: t.status,
    translations: t.translations,
  }));

  const html = renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <TripListProvider trips={trips}>
          <CurrencyProvider options={currencyOptions("alex")}>
            <TripProvider trip={props.trip} isCurrent>
              <TripStory
                index={props.index}
                days={props.days}
                windowStart={props.windowStart}
                initialDate={props.initialDate}
                openAtDate={props.openAtDate}
                stats={props.stats}
              />
            </TripProvider>
          </CurrencyProvider>
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
  return { html, props };
}

describe("costLocalForDay", () => {
  test("a single foreign currency sums to that currency", () => {
    const entries = getAllEntries(REF).filter((e) => e.date === "2026-06-01");
    expect(costLocalForDay(REF, entries)).toEqual({ amount: 520, currency: "THB" });
  });

  test("a mixed-currency day carries nothing — summing two currencies would fabricate a total", () => {
    const entries = getAllEntries(REF).filter((e) => e.date === "2026-06-02");
    expect(costLocalForDay(REF, entries)).toBeUndefined();
  });

  test("a base-currency day has nothing to add beside the converted total", () => {
    const entries = getAllEntries(REF).filter((e) => e.date === "2026-06-03");
    expect(costLocalForDay(REF, entries)).toBeUndefined();
  });
});

describe("the day view leads with what was actually paid", () => {
  test("the single-currency day carries costLocal and the mixed/base days do not", () => {
    const { props } = render();
    const byDate = Object.fromEntries(props.index.map((d) => [d.date, d]));
    expect(byDate["2026-06-01"].costLocal).toEqual({ amount: 520, currency: "THB" });
    expect(byDate["2026-06-02"].costLocal).toBeUndefined();
    expect(byDate["2026-06-03"].costLocal).toBeUndefined();
  });

  test("the page shows the paid amount and the converted one, marked ≈", () => {
    // 400 + 120 THB at 0.026 CHF/THB is CHF 13.52, rounded to 14.
    const { html } = render({}, "2026-06-01");
    expect(html).toMatch(/THB\s*520[\s\S]*≈[\s\S]*CHF\s*14/);
  });

  test("a mixed-currency day shows only its one converted total, no ≈ beside it", () => {
    // Scoped to the open day's own card: the sidebar (GamePath) lists every
    // day at once and, since B554, marks day one's own THB total with ≈
    // regardless of which day is open — that is the fix working, not this
    // day acquiring a local figure it must not have.
    const { html } = render({}, "2026-06-02");
    const main = mainOnly(html);
    // 200 THB (≈5.20) + 5 EUR (≈4.80) ≈ CHF 10 — one figure, and no local
    // amount or ≈ to go with it: two currencies never sum into one "local".
    expect(main).toContain("CHF 10");
    expect(main).not.toContain("≈");
    expect(main).not.toContain("THB");
  });

  test("a base-currency day is unchanged: no local figure, no ≈", () => {
    const { html } = render({}, "2026-06-03");
    const main = mainOnly(html);
    expect(main).toContain("CHF 30");
    expect(main).not.toContain("≈");
  });

  /**
   * B544's privacy edge: `costLocal` is exactly the field a guest-hidden
   * trip must keep out of the page, because `costsVisibility: guests` is a
   * promise about numbers and a figure omitted from the drawn page but
   * present in what a component *could* read is not omitted.
   */
  test("a reader who may not see costs gets neither figure, anywhere in the page source", () => {
    const { html, props } = render({ showCosts: false }, "2026-06-01");
    for (const day of props.index) {
      expect(day.cost).toBe(0);
      expect(day.costLocal).toBeUndefined();
    }
    expect(html).not.toContain("THB");
    expect(html).not.toContain("≈");
    expect(html).not.toContain("CHF 14");
    expect(html).not.toContain("CHF 10");
    expect(html).not.toContain("CHF 30");
  });
});

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
import { dictionaryFor } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { buildStoryProps } from "@/lib/tripView";
import { createTrip } from "@/lib/tripWrite";
import { getTrips } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";

/**
 * B353 — a trip whose currency has no rate showed CHF 0 everywhere except
 * the costs page.
 *
 * `balkans-2026` here is the live incident: base currency CHF, one day's
 * spend logged in EUR, no `rates:` on the trip at all — so every cost is
 * left out of the total, the way the ticket found it (not merely a short
 * total, the fully-empty case). The costs page has always said so; the
 * journal home and the trip overview — both `TripHero`, via `TripStory` —
 * used to print CHF 0 instead.
 */

let dir: string;
const REF = "alex/balkans-2026";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-unconverted-"));
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
    id: "balkans-2026",
    title: "Balkans",
    start: "2026-06-01",
    end: "2026-06-10",
    status: "current",
    visibility: "public",
    // No `rates:` — the trip found live had none either.
  });
  if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

  const draft = createDraft(REF, {
    title: "Belgrade",
    date: "2026-06-02",
    location: "Belgrade",
    country: "Serbia",
    content: "First day on the road.",
    costs: [{ label: "Dinner", amount: 80, currency: "EUR", category: "food" }],
  });
  if (!draft.ok) throw new Error(`could not write the draft: ${draft.error}`);
  const published = publishDraft(REF, draft.slug);
  if (!published.ok) throw new Error(`could not publish: ${published.error}`);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function render(): string {
  const props = buildStoryProps(REF);
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

  return renderToStaticMarkup(
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
}

test("buildStoryProps carries what the totals had to leave out", () => {
  const { stats } = buildStoryProps(REF);
  expect(stats.unconverted).toEqual([{ currency: "EUR", amount: 80, count: 1 }]);
  // The whole trip's spend is in the one currency with no rate, so the
  // total sums to zero — exactly the figure that must not render plain.
  expect(stats.totalSpend).toBe(0);
});

describe("the trip hero, on a trip with an unrated currency", () => {
  test("does not print CHF 0 as the total or the daily average", () => {
    const html = render();
    expect(html).not.toContain("CHF 0");
    // A dash where the figure used to be — never a confident number that
    // happens to be wrong.
    expect(html).toMatch(/Total so far<\/dt> <dd[^>]*>—<\/dd>/);
    expect(html).toMatch(/Average per day<\/dt> <dd[^>]*>—<\/dd>/);
  });

  test("says what was left out, in the costs page's own words", () => {
    const html = render();
    expect(html).toContain("Not counted in these totals");
    expect(html).toContain("EUR");
  });
});

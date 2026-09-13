import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * B214 — the costs page's description and its standfirst, in one tense.
 *
 * `generateMetadata` said `cost.subtitle` unconditionally — "from the visas
 * and jabs before we left to today's coffee" — while the standfirst one line
 * below it switches to `cost.subtitlePlanned` from `summary.hasBegun`, which is
 * B19's fix. Two sentences about one trip, one of them a claim the other
 * denies.
 *
 * Both now come from the same flag, asked the same way: `hasBegun(trip, days)`,
 * over the day list `getCostSummary` itself uses. Not the summary — it converts
 * every item in the trip and is not cached — and not `hasBegun(trip)` alone,
 * which is the cheap half and disagrees with the page for an `upcoming` trip
 * that already has a day written.
 *
 * **What this route can and cannot be in.** `getCurrentTrip` returns whichever
 * trip `today` falls inside, or else the most recent `past` one, and
 * `hasBegun` is true for both. v1 had a `status: current` an author could
 * declare against a start still ahead of it (B72); v2 retired the field
 * outright (decision "status/tracks retired", lib/trips.ts's `deriveStatus`)
 * — `current` is now purely a calendar fact, so that particular edge case no
 * longer exists to build. The planned wording at `/<user>/costs` still
 * belongs to one state only: no current trip at all, where the page redirects
 * to the trip list. The assertions below are about the pairing rather than
 * about a mismatch that can be observed on this route, and that is the honest
 * reading — the ticket's Why placed the defect here, and the state it
 * describes cannot be built.
 */

const request = vi.hoisted(() => ({ cookieLocale: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => "/alex/costs" }),
}));

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
import { getCurrentTrip } from "@/lib/trips";
import { generateMetadata } from "@/app/[user]/(trip)/costs/page";
import CostsPageContent from "@/app/[user]/(trip)/costs/CostsPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import type { CostSummary } from "@/lib/costFormat";
import type { SiteSummary } from "@/lib/site";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";

const LOCALES = ["en", "de", "hu"] as const;

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

/**
 * A journal in one of the two states this route can be in: a current trip
 * under way, or no current trip at all.
 */
function journal(opts: { locale: string; withTrip: boolean }): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-tense-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: opts.locale,
      locales: [opts.locale],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
  if (opts.withTrip) {
    writeTripFixture("alex", {
      id: "ridge-2025",
      title: "Along the ridge",
      start: "2025-05-01",
      end: "2025-05-10",
      status: "current",
      visibility: "public",
      intro: "Something.",
    });
    writeDayFixture(dir, "alex", "ridge-2025", {
      slug: "first",
      date: "2025-05-02",
      title: "First",
      location: "Chur",
      content: "A day.",
    });
    // Not on writeTripFixture (B1630): `createTrip` has no way to write a
    // trip's `costs` budget at all — `costs.md` is dead once a trip is
    // written as v2 `trip.json` (`hasCostsData`/`readCostsFile` read
    // `trip.costsSection`, never the file). Merge it onto the trip document
    // directly, the same door `writeTripFile` is for
    // `test/api-v2-figures.test.ts`'s figure reference. Without this the
    // page 404s on its own missing budget (B267) before this file's tense
    // assertions ever run.
    const written = readTripFile("alex", "ridge-2025");
    writeTripFile("alex", "ridge-2025", {
      ...written!,
      costs: { budget: { total: 100, days: 10 }, note: "Before we left." },
    });
  }
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
}

const site = {
  username: "alex",
  title: "A journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  hasAccessPanel: false,
} as unknown as SiteSummary;

const EMPTY: CostSummary = {
  baseCurrency: "CHF",
  hasBegun: true,
  isOver: false,
  total: 0,
  onTheRoad: 0,
  preparation: 0,
  perDay: 0,
  daysWithSpend: 0,
  unrecordedDays: 0,
  byCategory: [],
  byCountry: [],
  byDay: [],
  items: [],
  unconverted: [],
  ratesFrom: {},
};

/**
 * The standfirst the reader actually sees, for a summary with this flag.
 *
 * Rendered rather than restated, so the two halves of each assertion are the
 * real ones — the same reason test/map-tense.test.tsx renders its `<h1>`.
 */
function standfirstOf(locale: string, summary: CostSummary): string {
  const html = renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <CostsPageContent summary={summary} travellers="A" />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
  // The standfirst is the paragraph immediately after the `<h1>`.
  const match = /<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
  if (!match) throw new Error("the costs page rendered no standfirst");
  return match[1].replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

async function descriptionOf(): Promise<string> {
  const meta = await generateMetadata({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  });
  return String(meta.description);
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = undefined;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe.each(LOCALES)("a journal reading in %s", (locale) => {
  const dict = dictionaryFor(locale);

  test("a trip under way: the description is the standfirst the page renders", async () => {
    journal({ locale, withTrip: true });
    const trip = getCurrentTrip("alex");
    if (!trip) throw new Error("the fixture has no current trip");
    const summary = getCostSummary(trip.ref);

    // The page's own flag, from the page's own summary.
    expect(summary.hasBegun).toBe(true);
    expect(await descriptionOf()).toBe(dict["cost.subtitle"].replace("{currency}", "CHF"));
    expect(await descriptionOf()).toBe(standfirstOf(locale, summary));
  });

  test("no trip under way: the description claims the less of the two", async () => {
    journal({ locale, withTrip: false });

    expect(getCurrentTrip("alex")).toBeUndefined();
    expect(await descriptionOf()).toBe(dict["cost.subtitlePlanned"].replace("{currency}", "CHF"));
    expect(await descriptionOf()).toBe(
      standfirstOf(locale, { ...EMPTY, hasBegun: false }),
    );
  });

  test("the two strings are actually different in this language", () => {
    // Otherwise the pairing above holds on a dictionary nobody translated.
    expect(dict["cost.subtitlePlanned"]).toBeTruthy();
    expect(dict["cost.subtitlePlanned"]).not.toBe(dict["cost.subtitle"]);
  });
});

/**
 * The flag itself, rather than the two sentences it picks between.
 *
 * `getCostSummary` is what the page reads and `hasBegun(trip, getDays(...))` is
 * what the metadata reads, and the whole point of B214 is that those are the
 * same question. A trip declared `current` whose start is still ahead of it is
 * the case worth pinning: it reads as begun in both, because `current` is the
 * author's word about which trip the bare URLs serve and no date arithmetic
 * takes it away.
 */
describe("the flag the description and the page share", () => {
  // v1's `status: current` was an author's own declared word and stood even
  // against a `start` still ahead of it (B72's own fix) — this test used to
  // pin exactly that: a trip declared current, dated into the future,
  // reading as begun anyway. v2 retired the field outright (decision
  // "status/tracks retired", lib/trips.ts's `deriveStatus`): `current` is
  // now purely `today` falling within `[start, end]`, so a future-dated
  // trip cannot be made to read as current at all any more — there is no
  // state left to build that pins the old edge case. What is left of the
  // property is the pairing itself: whatever `deriveStatus` calls current,
  // `getCostSummary` (the page) and `hasBegun` (the metadata) must agree is
  // begun. The system clock is pinned, same reason as
  // `test/currency.test.ts`'s "the plan and the spend are compared in the
  // same currency" — `deriveStatus` reads the real clock, so a trip's dates
  // alone cannot stay "current" as real time moves past them.
  test("a current trip reads as begun on both sides", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-05-05T12:00:00Z"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-tense-ahead-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
    fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({
        title: "A journal",
        tagline: "t",
        owner: { name: "A B", nickname: "A" },
        startLocation: "X",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        features: {},
      }),
    );
    clearConfigCache();
    clearUserCache();
    writeTripFixture("alex", {
      id: "ridge-2099",
      title: "Ahead",
      start: "2099-05-01",
      end: "2099-05-10",
      visibility: "public",
      intro: "Something.",
    });
    // Not on writeTripFixture (B1630) — see the note above.
    const written2099 = readTripFile("alex", "ridge-2099");
    writeTripFile("alex", "ridge-2099", {
      ...written2099!,
      costs: { budget: { total: 100, days: 10 }, note: "Before we left." },
    });
    process.env.CONTENT_DIR = dir;
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();

    try {
      const current = getCurrentTrip("alex");
      if (!current) throw new Error("the fixture has no current trip");
      expect(getCostSummary(current.ref).hasBegun).toBe(true);
      expect(await descriptionOf()).toBe(
        dictionaryFor("en")["cost.subtitle"].replace("{currency}", "CHF"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

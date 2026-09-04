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
 * **What this route can and cannot be in.** `getCurrentTrip` returns a trip
 * declaring `status: current` or else the most recent `past` one, and
 * `hasBegun` is true for both — `current` is the author's own word and is
 * honoured as written (see lib/tripTime.ts), so a trip declared current with a
 * start still ahead of it reads as begun here exactly as it does on the page.
 * The planned wording at `/<user>/costs` therefore belongs to one state only:
 * no current trip at all, where the page redirects to the trip list. The
 * assertions below are about the pairing rather than about a mismatch that can
 * be observed on this route, and that is the honest reading — the ticket's
 * Why placed the defect here, and the state it describes cannot be built.
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

const LOCALES = ["en", "de", "hu"] as const;

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

/**
 * A journal in one of the two states this route can be in: a current trip
 * under way, or no current trip at all.
 */
function journal(opts: { locale: string; withTrip: boolean }): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-tense-"));
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
  if (opts.withTrip) {
    const trip = path.join(dir, "alex", "trips", "ridge-2025");
    fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(trip, "trip.md"),
      '---\nid: ridge-2025\ntitle: "Along the ridge"\nstart: "2025-05-01"\nend: "2025-05-10"\n' +
        "status: current\nvisibility: public\n---\n\nSomething.\n",
    );
    fs.writeFileSync(
      path.join(trip, "entries", "2025-05-02-first.md"),
      '---\ntitle: "First"\ndate: "2025-05-02"\nlocation: "Chur"\n---\n\nA day.\n',
    );
    // Without this the page 404s on its own missing budget (B267) before
    // this file's tense assertions ever get to run.
    fs.writeFileSync(
      path.join(trip, "costs.md"),
      "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
    );
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
  total: 0,
  onTheRoad: 0,
  preparation: 0,
  perDay: 0,
  daysWithSpend: 0,
  byCategory: [],
  byCountry: [],
  byDay: [],
  items: [],
  unconverted: [],
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
  test("a current trip with a future start reads as begun on both sides", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-tense-ahead-"));
    fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
    const trip = path.join(dir, "alex", "trips", "ridge-2099");
    fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
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
    fs.writeFileSync(
      path.join(trip, "trip.md"),
      '---\nid: ridge-2099\ntitle: "Ahead"\nstart: "2099-05-01"\nend: "2099-05-10"\n' +
        "status: current\nvisibility: public\n---\n\nSomething.\n",
    );
    fs.writeFileSync(
      path.join(trip, "costs.md"),
      "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
    );
    process.env.CONTENT_DIR = dir;
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();

    const current = getCurrentTrip("alex");
    if (!current) throw new Error("the fixture has no current trip");
    expect(getCostSummary(current.ref).hasBegun).toBe(true);
    expect(await descriptionOf()).toBe(
      dictionaryFor("en")["cost.subtitle"].replace("{currency}", "CHF"),
    );
  });
});

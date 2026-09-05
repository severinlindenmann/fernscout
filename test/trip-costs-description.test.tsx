import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * B214 / B382 — the trip-scoped costs page's `<meta name="description">`.
 *
 * It was a literal English sentence, always past tense, naming the journal by
 * `trip.username` — the URL slug — rather than its title or the currency the
 * sentence is actually about: "What Cherry blossom, north to south actually
 * cost, itemised in xydhd-lifecycle's currency." on a trip that had not
 * started, observed on fernscout.ch at e85248d.
 *
 * Fixed by asking the tense the way the sibling page's own metadata does
 * (`hasBegun(trip, days)`, not `getCostSummary`) and naming the currency
 * instead of the slug.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => "/alex/trips/ridge-2025/costs" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePathname: () => "/alex/trips/ridge-2025/costs",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function journal(locale = "en"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-costs-description-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);

  const past = path.join(dir, "alex", "trips", "ridge-2025");
  fs.mkdirSync(path.join(past, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(past, "trip.md"),
    '---\nid: ridge-2025\ntitle: "Along the ridge"\nstart: "2025-05-01"\nend: "2025-05-10"\n' +
      "status: past\nvisibility: public\n---\n\nSomething.\n",
  );
  fs.writeFileSync(
    path.join(past, "costs.md"),
    "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
  );

  const upcoming = path.join(dir, "alex", "trips", "cherry-blossom");
  fs.mkdirSync(path.join(upcoming, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(upcoming, "trip.md"),
    '---\nid: cherry-blossom\ntitle: "Cherry blossom, north to south"\nstart: "2027-04-03"\n' +
      'end: "2027-04-20"\nstatus: upcoming\nvisibility: public\n---\n\nSomething.\n',
  );
  fs.writeFileSync(
    path.join(upcoming, "costs.md"),
    "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
  );

  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "The Lifecycle Journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: locale,
      locales: [locale],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("a trip-scoped costs page's description", () => {
  test("a finished trip is past tense; an upcoming one is a budget, and neither names the username", async () => {
    process.env.CONTENT_DIR = journal();
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    const { clearLocaleCache } = await import("@/lib/locales");
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();
    const { generateMetadata } = await import("@/app/[user]/trips/[trip]/costs/page");

    const past = await generateMetadata({
      params: Promise.resolve({ user: "alex", trip: "ridge-2025" }),
      searchParams: Promise.resolve({}),
    });
    const upcoming = await generateMetadata({
      params: Promise.resolve({ user: "alex", trip: "cherry-blossom" }),
      searchParams: Promise.resolve({}),
    });

    expect(past.description).toBe("What Along the ridge actually cost, itemised in CHF.");
    expect(upcoming.description).toBe(
      "What Cherry blossom, north to south is budgeted to cost, itemised in CHF.",
    );
    expect(past.description).not.toBe(upcoming.description);
    // Past tense must not leak into a trip that has not started.
    expect(upcoming.description).not.toMatch(/actually cost/);

    for (const description of [past.description, upcoming.description]) {
      expect(description).not.toContain("alex");
    }
  });
});

/**
 * B250 — the description agrees with the standfirst *this* route renders,
 * in German and Hungarian too, not only in English.
 *
 * The page's own body (`CostsPageContent`, shared with the journal-scoped
 * route) picks `cost.subtitle` / `cost.subtitlePlanned` from
 * `summary.hasBegun`; the metadata above picks `cost.tripDescription` /
 * `cost.tripDescriptionPlanned` from `hasBegun(trip, getDays(trip.ref))`. Two
 * questions asked the same way should never land on opposite tenses, in any
 * language the dictionaries carry.
 */
describe.each(["en", "de", "hu"] as const)("a trip-scoped costs page in %s", (locale) => {
  test("the description and the standfirst agree on whether the trip has begun", async () => {
    process.env.CONTENT_DIR = journal(locale);
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    const { clearLocaleCache, dictionaryFor } = await import("@/lib/locales");
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();
    const { generateMetadata } = await import("@/app/[user]/trips/[trip]/costs/page");
    const CostsPageContent = (await import("@/app/[user]/(trip)/costs/CostsPageContent")).default;
    const LocaleProvider = (await import("@/components/LocaleProvider")).default;
    const SiteProvider = (await import("@/components/SiteProvider")).default;
    const CurrencyProvider = (await import("@/components/CurrencyProvider")).default;
    const TripListProvider = (await import("@/components/TripListProvider")).default;
    const { getCostSummary } = await import("@/lib/costs");
    const { getTrip, tripRef } = await import("@/lib/trips");

    const dict = dictionaryFor(locale);
    const site = {
      username: "alex",
      title: "The Lifecycle Journal",
      tagline: "t",
      url: "https://example.test",
      startLocation: "X",
      baseCurrency: "CHF",
      locales: [locale],
      base: "/alex",
      hasAccessPanel: false,
    };

    function standfirstOf(tripId: string): string {
      const summary = getCostSummary(tripRef("alex", tripId));
      const html = renderToStaticMarkup(
        <LocaleProvider locale={locale} dictionary={dict}>
          <SiteProvider value={site as never}>
            <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
              <TripListProvider trips={[]}>
                <CostsPageContent summary={summary} travellers="A" />
              </TripListProvider>
            </CurrencyProvider>
          </SiteProvider>
        </LocaleProvider>,
      );
      const match = /<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
      if (!match) throw new Error("the costs page rendered no standfirst");
      return match[1];
    }

    for (const tripId of ["ridge-2025", "cherry-blossom"] as const) {
      const trip = getTrip(tripRef("alex", tripId));
      if (!trip) throw new Error(`fixture missing trip ${tripId}`);
      const meta = await generateMetadata({
        params: Promise.resolve({ user: "alex", trip: tripId }),
        searchParams: Promise.resolve({}),
      });
      const description = String(meta.description);
      const standfirst = standfirstOf(tripId);

      // "Planned" is the discriminator both keys share: the description came
      // from `cost.tripDescriptionPlanned` exactly when the standfirst came
      // from `cost.subtitlePlanned` — never one begun and the other not.
      const descriptionIsPlanned = description === dict["cost.tripDescriptionPlanned"]
        .replace("{trip}", trip.title)
        .replace("{currency}", "CHF");
      const standfirstIsPlanned = standfirst.includes(
        dict["cost.subtitlePlanned"].replace("{currency}", "CHF"),
      );
      expect(descriptionIsPlanned).toBe(standfirstIsPlanned);
    }
  });

  test("the two tenses are actually different strings in this language", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    const dict = dictionaryFor(locale);
    expect(dict["cost.tripDescriptionPlanned"]).toBeTruthy();
    expect(dict["cost.tripDescriptionPlanned"]).not.toBe(dict["cost.tripDescription"]);
  });
});

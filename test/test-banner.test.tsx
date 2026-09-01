import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StoryPager, { buildSteps } from "@/components/StoryPager";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Day, DaySummary, Trip } from "@/lib/types";

/**
 * The banner that says a day did not happen.
 *
 * `test/test-content.test.ts` proves the flag is read from the file and keeps
 * the day out of the feed, the search index and the sitemap. It says nothing
 * about the page, and the page is where the promise is actually kept: a test
 * day is *reachable* by its URL, so the person who opens it has only the
 * banner to tell them none of it is real.
 *
 * That could not be checked by fetching the page. The story opens on the trip
 * hero and renders day cards as the reader pages forward, so the first screen
 * has no day on it at all — a curl of `/<user>` is silent about this either
 * way. Rendering the component is what answers the question.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
} as unknown as SiteSummary;

const trip = {
  id: "reise",
  username: "alex",
  ref: "alex/reise",
  title: "Testreise",
  start: "2026-09-01",
  end: "2026-09-02",
  status: "current",
  accent: "sky",
  rates: {},
  intro: "",
  people: [],
  visibility: "public",
  listed: true,
  costsVisibility: "public",
} as unknown as Trip;

function dayWith(over: { draft?: boolean; test?: boolean }): Day {
  const entry = {
    slug: "erster-tag",
    title: "Erster Tag",
    date: "2026-09-01",
    location: "Bellinzona",
    country: "Switzerland",
    lat: 46.1944,
    lng: 9.0175,
    gallery: [],
    tags: [],
    costs: [],
    content: "Ankunft am Morgen.",
    ...over,
  } as unknown as Day["entries"][number];
  return { date: "2026-09-01", entries: [entry], lead: entry };
}

const summary = {
  date: "2026-09-01",
  slug: "erster-tag",
  location: "Bellinzona",
  country: "Switzerland",
  lat: 46.1944,
  lng: 9.0175,
  updates: 1,
  cost: 0,
} as unknown as DaySummary;

function render(day: Day, tripOver: Partial<Trip> = {}) {
  const steps = buildSteps([summary]);
  // Step 0 is the trip hero; the day card is the next one. This is exactly
  // why the banner cannot be seen by fetching `/<user>`: the first screen has
  // no day on it.
  const dayStep = steps.findIndex((s) => s.kind === "day");
  expect(dayStep).toBeGreaterThan(0);

  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripProvider trip={{ ...trip, ...tripOver } as Trip} isCurrent>
            <StoryPager
              index={[summary]}
              dayAt={() => day}
              steps={steps}
              stepIndex={dayStep}
              onStepChange={() => {}}
              onLegDone={() => {}}
            />
          </TripProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the test-content banner", () => {
  test("a day marked test carries it", () => {
    const html = render(dayWith({ test: true }));
    expect(html).toContain("data-test-notice");
    expect(html).toContain("this is not a real day");
  });

  test("a trip marked test puts it on a day that is not marked itself", () => {
    // The flag is inherited: somebody exercising the pipeline sets it once on
    // the trip rather than remembering it on every entry.
    const html = render(dayWith({}), { test: true });
    expect(html).toContain("data-test-notice");
  });

  test("an ordinary day carries no banner", () => {
    const html = render(dayWith({}));
    expect(html).not.toContain("data-test-notice");
  });

  test("a draft that is also a test day says both things", () => {
    // They answer different questions — "nobody else can see this" and
    // "none of this happened" — and an agent's invented test day is usually
    // both at once.
    const html = render(dayWith({ draft: true, test: true }));
    expect(html).toContain("data-test-notice");
    expect(html).toContain("data-draft-notice");
  });
});

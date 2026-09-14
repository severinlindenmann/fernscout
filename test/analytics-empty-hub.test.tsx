import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AnalyticsHubContent from "@/app/[user]/(trip)/analytics/AnalyticsHubContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * B1709 — the analytics hub of a trip with nothing measured.
 *
 * The tab is hidden journal-wide (`analyticsAvailable`) and cannot be hidden
 * per trip, so on a journal that records anything at all it is on every trip.
 * The hub used to `notFound()` when this trip had neither card, and the
 * journal's not-found copy says *"That trip isn't here any more. It was taken
 * down or renamed"* — about a trip the reader is standing on, reached by a
 * link that works.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/analytics",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site: SiteSummary = {
  username: "alex",
  title: "Alex's journal",
  tagline: "A tagline",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: false,
  hasIdentity: false,
  canSignIn: false,
  analyticsEnabled: true,
  helperEnabled: false,
  isOwner: false,
};

function markup(props: React.ComponentProps<typeof AnalyticsHubContent>, locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <AnalyticsHubContent {...props} />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("a trip with nothing to add up", () => {
  test("says so, in the reader's language", () => {
    expect(markup({})).toContain("Nothing to add up on this trip yet");
    expect(markup({}, "de")).toContain("noch nichts zusammenzuzählen");
  });

  /** The sentence explains an absence. A hub that has a card to show must not
   * also claim there is nothing. */
  test("and the sentence is gone the moment there is a card", () => {
    const html = markup({ weather: { href: "/alex/weather", measured: 3, missing: 1 } });
    expect(html).not.toContain("Nothing to add up on this trip yet");
    expect(html).toContain("/alex/weather");
  });
});

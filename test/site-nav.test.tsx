import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SiteNav from "@/components/SiteNav";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Trip } from "@/lib/types";

/**
 * Every URL carries the owner.
 *
 * `/trips`, `/search` and `/join` belong to the journal rather than to one
 * trip, so `useTrip()` is null there — and the fallback was the bare path.
 * Clicking "Costs" from the trip list went to `/costs`: nobody's journal, and
 * an error page. The journal's base is the right fallback, because that is
 * where the current trip lives.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const pathname = { current: "/alex/trips" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const site: SiteSummary = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  travellerNames: "Alex",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  signedIn: false,
};

const trip = {
  id: "asia-2023",
  ref: "alex/asia-2023",
  username: "alex",
  title: "Asia",
} as unknown as Trip;

function render(withTrip: boolean, isCurrent = false) {
  const nav = (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        {withTrip ? (
          <TripProvider trip={trip} isCurrent={isCurrent}>
            <SiteNav />
          </TripProvider>
        ) : (
          <SiteNav />
        )}
      </SiteProvider>
    </LocaleProvider>
  );
  return [...renderToStaticMarkup(nav).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe("SiteNav", () => {
  test("with no trip in context, every link still names the journal", () => {
    const hrefs = render(false);
    expect(hrefs).toContain("/alex/costs");
    expect(hrefs).toContain("/alex/gallery");
    expect(hrefs).toContain("/alex/map");
    expect(hrefs).toContain("/alex/trips");
    expect(hrefs).toContain("/alex/search");
    // The story link is the journal itself, not a trailing slash.
    expect(hrefs).toContain("/alex");
    expect(hrefs.some((h) => !h.startsWith("/alex"))).toBe(false);
  });

  test("on the current trip, the bare URLs", () => {
    const hrefs = render(true, true);
    expect(hrefs).toContain("/alex/costs");
    expect(hrefs).toContain("/alex");
  });

  test("on any other trip, the trip's own URLs", () => {
    const hrefs = render(true, false);
    expect(hrefs).toContain("/alex/trips/asia-2023/costs");
    expect(hrefs).toContain("/alex/trips/asia-2023");
    // /trips and /search stay at the journal level even inside a trip.
    expect(hrefs).toContain("/alex/trips");
    expect(hrefs).toContain("/alex/search");
  });
});

/**
 * The access panel is offered only to somebody who has one.
 *
 * A stranger who opened it would find a single line telling them to follow the
 * link they were sent, and a menu entry leading to "you have nothing" is worse
 * than no entry at all.
 */
describe("the access panel link", () => {
  /**
   * Offered to everyone, including a stranger. Gating it on a session was a
   * closed loop: `/join` is linked from nowhere else, so the one page that
   * exists to help a reader who lost their invitation email could only be
   * opened by a reader who still had it. A black-box tester spent her whole
   * session unable to find any way to sign in, and was right.
   */
  test("is offered whether or not there is a session", () => {
    expect(render(false)).toContain("/alex/me");
    site.signedIn = true;
    try {
      expect(render(false)).toContain("/alex/me");
    } finally {
      site.signedIn = false;
    }
  });
});

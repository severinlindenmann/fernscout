import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SiteNav from "@/components/SiteNav";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripListProvider, { type TripSummary } from "@/components/TripListProvider";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Trip } from "@/lib/types";

/**
 * Every URL carries the owner.
 *
 * `/trips`, `/search` and `/me` belong to the journal rather than to one
 * trip, so `useTrip()` is null there — and the fallback was the bare path.
 * Clicking "Costs" from the trip list went to `/costs`: nobody's journal, and
 * an error page. The journal's base is the right fallback, because that is
 * where the current trip lives.
 */

// Every prop, not just `href`: B44's fix is drawn in the class list and in the
// label's visibility, so a stub that dropped them would let the regression
// back in with the tests still green.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
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
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  signedIn: false,
  canSignIn: false,
  costsEnabled: true,
};

const trip = {
  id: "asia-2023",
  ref: "alex/asia-2023",
  username: "alex",
  title: "Asia",
} as unknown as Trip;

/** The nav as it is actually mounted, markup and all. */
function markup(
  withTrip: boolean,
  isCurrent = false,
  { locale = "en", trips = [] as TripSummary[] } = {},
) {
  const nav = (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <TripListProvider trips={trips}>
          {withTrip ? (
            <TripProvider trip={trip} isCurrent={isCurrent}>
              <SiteNav />
            </TripProvider>
          ) : (
            <SiteNav />
          )}
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>
  );
  return renderToStaticMarkup(nav);
}

function render(withTrip: boolean, isCurrent = false) {
  return [...markup(withTrip, isCurrent).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

/** Just the entry that leads to `/alex/me`, which is the whole of B44's fix. */
function door(html: string): string {
  const match = html.match(/<a href="\/alex\/me"[\s\S]*?<\/a>/);
  if (!match) throw new Error("no /alex/me entry in the nav");
  return match[0];
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

  /**
   * B165 — costs is an optional capability, so the tab is one too.
   *
   * With `features.costs` off for this journal both costs pages answer 404,
   * and a tab leading to one is the same failure B44 fixed for the sign-in
   * door: a control that promises something that is not there. Absent rather
   * than broken.
   */
  describe("the costs tab follows the capability", () => {
    test("is gone when the journal does not do spending", () => {
      site.costsEnabled = false;
      try {
        const hrefs = render(false);
        expect(hrefs).not.toContain("/alex/costs");
        // And nothing else in the row went with it.
        expect(hrefs).toContain("/alex/gallery");
        expect(hrefs).toContain("/alex/map");
        expect(hrefs).toContain("/alex/trips");
      } finally {
        site.costsEnabled = true;
      }
    });

    test("and is there when it does, in a trip's own context too", () => {
      expect(render(false)).toContain("/alex/costs");
      expect(render(true, true)).toContain("/alex/costs");
    });
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
   * closed loop: this is the one page that exists to help a reader who lost
   * their invitation email, so requiring a session meant only a reader who
   * still had it could open it. A black-box tester spent her whole session
   * unable to find any way to sign in, and was right.
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

/**
 * B44 — the door a reader who lost their invitation can actually see.
 *
 * The panel behind `/<user>/me` was written for the grandmother who opens the
 * journal once a month and has lost the mail she was let in with. Until this,
 * the only route to it was an unlabelled outline of a head: labels in this nav
 * start at `xl`, so on every phone and most laptops she was looking at six
 * icons and nothing that read as a way in.
 */
describe("the sign-in door", () => {
  test("a reader with no session, on a journal that can issue codes, gets a word", () => {
    site.canSignIn = true;
    try {
      const html = door(markup(false));
      // Visible at every width — not `hidden xl:inline`, which is the bug.
      expect(html).toContain(">Sign in</span>");
      expect(html).not.toContain("hidden xl:inline");
      // And it still reads as a control rather than another tab.
      expect(html).toContain("border border-navy-700");
    } finally {
      site.canSignIn = false;
    }
  });

  test("in every language the chrome speaks", () => {
    site.canSignIn = true;
    try {
      expect(door(markup(false, false, { locale: "de" }))).toContain(">Anmelden</span>");
      expect(door(markup(false, false, { locale: "hu" }))).toContain(">Belépés</span>");
    } finally {
      site.canSignIn = false;
    }
  });

  test("a reader who already has a session is not offered one", () => {
    site.canSignIn = true;
    site.signedIn = true;
    try {
      const html = door(markup(false));
      expect(html).not.toContain("Sign in");
      // The access panel is still reachable, exactly as before.
      expect(html).toContain("Your access");
      expect(html).toContain("hidden xl:inline");
    } finally {
      site.canSignIn = false;
      site.signedIn = false;
    }
  });

  /**
   * A journal with `auth` off has no form behind that page — only a line
   * saying to ask whoever writes it for a link. A control marked "Sign in"
   * leading there is worse than no control: absent rather than broken.
   */
  test("a journal that cannot issue a code offers no door at all", () => {
    const html = door(markup(false));
    expect(html).not.toContain("Sign in");
    expect(html).toContain("hidden xl:inline");
    expect(html).not.toContain("border border-navy-700");
  });

  /**
   * The constraint the whole design turns on.
   *
   * "3 trips are not shown to you" would tell an anonymous prober that three
   * private trips exist on a journal whose owner may not want that known. So
   * what this draws must be identical for a journal with ten hidden trips and
   * one with none — it is a function of the session cookie and `features.auth`
   * and of nothing the gate did.
   *
   * Both lists below are what `listableTrips` would have returned; the second
   * is a journal where it removed nothing. Wire a count, a title or an id into
   * the chrome by any route and these stop matching.
   */
  test("what it draws does not vary with what the gate filtered", () => {
    site.canSignIn = true;
    try {
      const filtered: TripSummary[] = [];
      const unfiltered: TripSummary[] = [
        { id: "asia-2023", title: "Asia", start: "2023-01-01", end: "2023-02-01", status: "past" },
        { id: "north", title: "North", start: "2024-01-01", end: "2024-02-01", status: "past" },
        { id: "south", title: "South", start: "2025-01-01", end: "2025-02-01", status: "past" },
      ];
      const hidden = markup(false, false, { trips: filtered });
      const shown = markup(false, false, { trips: unfiltered });
      expect(hidden).toBe(shown);
      for (const entry of unfiltered) {
        expect(hidden).not.toContain(entry.title);
        expect(hidden).not.toContain(entry.id);
      }
      // And no count of them, anywhere.
      expect(door(hidden)).toBe(door(shown));
    } finally {
      site.canSignIn = false;
    }
  });
});

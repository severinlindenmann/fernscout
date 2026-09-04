import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TripsIndexContent, {
  type EmptyJournal,
  type TripCardData,
} from "@/app/[user]/trips/TripsIndexContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * The first page a new journal's owner sees (B76).
 *
 * `/<user>` redirects to `/<user>/trips`, so an empty journal's trip list is
 * the whole site for as long as it stays empty. It used to render a subtitle
 * promising a record of everywhere its owner had been, over four stat tiles
 * reading 0 · 0 · 0 · 0, and hide everything else — a page that looked
 * finished and said nothing, on which the one thing the owner could not guess
 * (there is no button; a trip is made by an agent — ROADMAP decision 24) was
 * written down only on a page they had no reason to have opened.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/trips",
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
  // Both read by EmptyState via useSite() — see TripsIndexContent. Fixed for
  // every test in this file, including the two compared in the
  // byte-identity test, so neither can be the thing that makes them differ.
  canSignIn: true,
  signedIn: false,
} as unknown as SiteSummary;

const DOC_URL = "https://example.test/documentation.txt";
const OWNER_EMAIL = "owner@example.test";
const OWNER_NAME = "Viki";
const CODE_MINUTES = "30";

const aTrip: TripCardData = {
  id: "asia",
  title: "Asia",
  accent: "sky",
  status: "past",
  start: "2026-01-01",
  end: "2026-01-05",
  tripDays: 5,
  countries: 2,
  totalMedia: 40,
};

function render(
  over: {
    empty?: EmptyJournal | null;
    trips?: TripCardData[];
    lifetime?: { countries: number; days: number; photos: number; trips: number };
    locale?: string;
  } = {},
) {
  const locale = over.locale ?? "en";
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        {/* The page draws the header, which carries the currency and trip
            controls — needed even though nothing here asserts on them. */}
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <TripsIndexContent
              trips={over.trips ?? []}
              routes={[]}
              lifetime={over.lifetime ?? { countries: 0, days: 0, photos: 0, trips: 0 }}
              empty={over.empty ?? null}
              codeMinutes={CODE_MINUTES}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

/** The four lifetime tiles, identified by their labels rather than by "0" —
 * a zero appears in a date and in a currency, a tile label does not. */
function statTiles(html: string): string[] {
  // `tn` picks the singular for a count of one, so each label is a pattern.
  return [/>country|>countries/, />days? on the road/, />photos &amp; videos/, />trips?</].filter(
    (label) => label.test(html),
  ).map(String);
}

describe("a journal with no trips", () => {
  test("renders no lifetime stat tiles at all", () => {
    expect(statTiles(render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } }))).toEqual([]);
    expect(statTiles(render({ empty: { owner: true, siteUrl: "https://example.test" } }))).toEqual([]);
  });

  test("drops the subtitle, which claims a record it does not have", () => {
    const html = render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } });
    expect(html).not.toContain("Everywhere we");
  });
});

describe("and its owner", () => {
  const owner: EmptyJournal = { owner: true, siteUrl: "https://example.test" };

  test("says there are no trips yet, in the journal's language", () => {
    expect(render({ empty: owner })).toContain("No trips yet");
    expect(render({ empty: owner, locale: "de" })).toContain("Noch keine Reisen");
    expect(render({ empty: owner, locale: "hu" })).toContain("Még nincs egyetlen út sem");
  });

  // Since B301: one button rather than two lines to hand over by hand.
  // `test/copy-line-name.test.tsx` holds the accessible-name half of this —
  // that the prompt the button produces is copyable without reciting a live
  // credential as its name.
  test("is given a button to press, not two lines to hand over", () => {
    const html = render({ empty: owner });
    expect(html).toContain(dictionaryFor("en")["me.handoverCreate"]);
    expect(html).not.toMatch(/read out the code/i);
  });

  test("is told there is no form and never will be", () => {
    expect(render({ empty: owner })).toMatch(/there is no form, and there never will be/i);
    expect(render({ empty: owner, locale: "de" })).toMatch(/es gibt kein Formular/i);
  });
});

/**
 * B270: the owner's third state. `page.tsx` sets `filtered: true` when the
 * owner has a real trip that `listableTrips` has filtered out from under them
 * too (a `public, listed: false` trip — deliberately unlisted for everyone,
 * owner included, see `test/access-gate.test.ts`). It must read differently
 * from genuine emptiness: there is a trip, so there is no first day to hand an
 * agent for.
 */
describe("and its owner, whose only trip is filtered out from under them", () => {
  const filtered: EmptyJournal = { owner: true, siteUrl: "https://example.test", filtered: true };

  test("is told nothing is listed, not that there are no trips yet", () => {
    const html = render({ empty: filtered });
    expect(html).toContain("Nothing listed here");
    expect(html).not.toContain("No trips yet");
  });

  test("is pointed at `listed: false` rather than handed the agent-handover button", () => {
    const html = render({ empty: filtered });
    expect(html).toMatch(/listed: false/);
    expect(html).not.toContain(dictionaryFor("en")["me.handoverCreate"]);
  });
});

/**
 * B264: a signed-out stranger, whether the journal is empty or full of
 * journeys none of which are theirs, is pointed at both ways in — an invite
 * link, or signing in — and told nothing about which situation it actually
 * is. See the block below for the byte-identity that guarantees it.
 */
describe("and a stranger", () => {
  test("never receives the owner's address", () => {
    const html = render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } });
    expect(html).not.toContain(OWNER_EMAIL);
    expect(html).not.toContain(DOC_URL);
  });

  test("is pointed at an invite link and at signing in, and nothing else", () => {
    const html = render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } });
    expect(html).toContain("Nothing here you can read");
    expect(html).toMatch(/invite link/i);
    expect(html).toMatch(/sign in/i);
  });

  test("in German and Hungarian too", () => {
    expect(render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME }, locale: "de" })).toContain(
      "Nichts, was du lesen kannst",
    );
    expect(render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME }, locale: "hu" })).toContain(
      "Nincs itt semmi, amit olvashatsz",
    );
  });

  /**
   * B278. "Ask whoever told you about it" named nobody a reader could
   * actually write to — see docs/tasks (B278) for the owner's own words on
   * meeting it. `ownerName` is computed in `page.tsx`, not here; this only
   * checks the component actually uses what it is handed.
   */
  test("names the owner, so there is somebody to ask", () => {
    expect(render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } })).toContain(
      `ask ${OWNER_NAME} for an invite link`,
    );
  });

  /**
   * `page.tsx` falls back to the journal's title when `owner.nickname` is
   * missing, so the component can be handed a title in place of a nickname —
   * this only proves it renders that, whatever it is, rather than leaving a
   * blank for a journal old enough to have none. A title without an
   * apostrophe, unlike `site.title`, so the assertion is not testing HTML
   * entity-escaping by accident.
   */
  test("never renders a blank name", () => {
    const titleFallback = "Fern Diaries";
    const html = render({ empty: { owner: false, signedIn: false, ownerName: titleFallback } });
    expect(html).toContain(`ask ${titleFallback} for an invite link`);
    expect(html).not.toMatch(/ask\s*for an invite link/);
  });

  /**
   * The one thing the owner actually asked for: a way to request and enter a
   * code without leaving this page, reusing `GuestSignIn` — the same form the
   * trip gate and `/<user>/me` already offer. Identified by its email field
   * rather than by prose, since the prose is shared with the trip gate too.
   */
  test("offers the code-request form in place, without leaving the page", () => {
    const html = render({ empty: { owner: false, signedIn: false, ownerName: OWNER_NAME } });
    expect(html).toContain('id="signin-email"');
  });
});

/**
 * B264's third case: a reader who already proved an address to *this*
 * journal and still has nothing to read. Telling them to sign in would be
 * useless — they already are — so they hear that coverage, not their
 * address, is the problem. `signedIn` comes from the reader's own cookie
 * (`signedInAs` in page.tsx), never from probing the journal, so this is safe
 * to say without becoming the leak B264 closes for a stranger.
 */
describe("and a reader already signed in to this journal", () => {
  test("hears coverage is the problem, not an invitation to sign in again", () => {
    const html = render({ empty: { owner: false, signedIn: true, ownerName: OWNER_NAME } });
    expect(html).toContain("You are signed in, but nothing here is shared with your address yet");
    expect(html).toContain(`Ask ${OWNER_NAME} to widen it`);
    expect(html).not.toMatch(/sign in with the address/i);
  });

  // Already proven their address to this journal — the form is for somebody
  // who has not, so offering it again would read as a broken page.
  test("is not offered the code-request form a second time", () => {
    const html = render({ empty: { owner: false, signedIn: true, ownerName: OWNER_NAME } });
    expect(html).not.toContain('id="signin-email"');
  });
});

/**
 * The whole point of the change. A signed-out reader must not be able to
 * tell a genuinely empty journal apart from one whose every trip the gate has
 * removed — that difference is a fact about somebody's private journal,
 * readable by anyone who tries the address, and B117 already refuses that
 * trade for a closed trip's own name.
 *
 * `page.tsx` only ever builds `empty` from the *filtered* list and never
 * hands this component the unfiltered one, so the two situations really do
 * collapse into one value before they arrive here. Proven by feeding the
 * component the `trips` and `lifetime` a filtered-but-not-empty journal would
 * have produced on the server, alongside the same `empty`, and finding the
 * two renders identical down to the byte — if a count, a heading or anything
 * else ever leaked through, this fails.
 *
 * B278 adds a name and a form to what a stranger sees, and both are exactly
 * as safe: `ownerName` is one value on `empty`, present or absent the same
 * way for a genuinely empty journal and a filtered one, and the form's
 * presence turns on `empty.signedIn` and `useSite().canSignIn` alone — never
 * on `trips` or `lifetime`, which is what the second `render()` call below
 * varies and the first does not. The `toBe` below already fails if either
 * ever started to differ; the explicit `toContain` just names what it is
 * that must not have been the odd one out.
 */
describe("a reader who may see nothing", () => {
  test("an empty journal and a fully filtered one render identically, signed out", () => {
    const empty: EmptyJournal = { owner: false, signedIn: false, ownerName: OWNER_NAME };
    const genuinelyEmpty = render({
      empty,
      trips: [],
      lifetime: { countries: 0, days: 0, photos: 0, trips: 0 },
    });
    const filteredToNothing = render({
      empty,
      trips: [aTrip],
      lifetime: { countries: 2, days: 5, photos: 40, trips: 1 },
    });
    expect(filteredToNothing).toBe(genuinelyEmpty);
    // The form is part of what is being proven identical, not a separate
    // claim — asserted here so a future change that drops it from both sides
    // at once (and so keeps `toBe` green) is still caught.
    expect(genuinelyEmpty).toContain('id="signin-email"');
  });

  test("same holds once signed in", () => {
    const empty: EmptyJournal = { owner: false, signedIn: true, ownerName: OWNER_NAME };
    const genuinelyEmpty = render({
      empty,
      trips: [],
      lifetime: { countries: 0, days: 0, photos: 0, trips: 0 },
    });
    const filteredToNothing = render({
      empty,
      trips: [aTrip],
      lifetime: { countries: 2, days: 5, photos: 40, trips: 1 },
    });
    expect(filteredToNothing).toBe(genuinelyEmpty);
    expect(genuinelyEmpty).not.toContain('id="signin-email"');
  });
});

/**
 * The seam with B44, which is a *different* bug: a guest looking at a journal
 * whose trips the gate has silently removed. `empty` is decided on the server
 * from the filtered list now (B264), so a guest with nothing left to list
 * gets `empty` set by `page.tsx` before this component ever runs — this only
 * asserts the other half, that the component itself performs no hiding of
 * its own and simply trusts the prop.
 */
describe("a journal whose trips exist", () => {
  test("still renders the four lifetime tiles", () => {
    const html = render({
      trips: [aTrip],
      lifetime: { countries: 2, days: 5, photos: 40, trips: 1 },
    });
    expect(statTiles(html)).toHaveLength(4);
    expect(html).toContain("Everywhere we");
  });

  test("passing an empty list without `empty` set still renders the ordinary page", () => {
    const html = render({ trips: [], lifetime: { countries: 0, days: 0, photos: 0, trips: 0 } });
    expect(statTiles(html)).toHaveLength(4);
    expect(html).not.toContain("No trips yet");
    expect(html).not.toContain("Nothing here you can read");
  });
});

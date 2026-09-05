import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PageHeader from "@/components/PageHeader";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * B170, and B212 which saw the same thing from outside: the journal's title,
 * clipped to "Ferns…" in a header with half a screen of empty space beside
 * it.
 *
 * The layout itself was measured in a real browser against `next start`, at
 * 320–1600px in all three maintained locales — jsdom has no layout engine and
 * cannot answer "is this element overflowing its box". What a test *can* hold
 * on to is the mechanism, which is one property of one flex item:
 *
 *   `flex-1` is `flex: 1 1 0%`, and that zero is the flex **base size** — the
 *   number a browser adds up to decide whether a row fits on one line. The
 *   title contributed nothing to that sum, so the row always "fitted", the nav
 *   never wrapped, and the title alone absorbed the shortfall: a 71px box for
 *   140px of "Fernscout Demo" at 1440.
 *
 * So: the title box must carry a real basis, and the nav's box must be able to
 * grow into the line it wraps onto, or `justify-end` has nothing to work with
 * and the pills end up on the left.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site: SiteSummary = {
  username: "alex",
  title: "Fernscout Demo",
  tagline: "Five journeys, to show what this thing does",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  signedIn: false,
  hasIdentity: false,
  canSignIn: false,
  costsEnabled: true,
};

function markup(): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            {/* What the story page mounts: the day counter and the progress
                bar in the chips row, which is the case that ran out of room. */}
            <PageHeader>
              <div className="hidden w-36 text-right text-xs xl:block">day 1 of 18</div>
            </PageHeader>
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

/** The class list of the element wrapping the journal's title and tagline. */
function titleBoxClasses(html: string): string {
  const match = /<div class="([^"]*)"><a [^>]*class="[^"]*truncate font-display/.exec(html);
  if (!match) throw new Error("the header rendered no title box");
  return match[1];
}

describe("the header's title box", () => {
  test("has a flex basis, so the row can be measured as not fitting", () => {
    const classes = titleBoxClasses(markup());
    // `flex-1` on its own is the bug: basis 0%.
    expect(classes.split(/\s+/)).not.toContain("flex-1");
    expect(classes).toMatch(/flex-\[1_1_\d+(?:\.\d+)?rem\]/);
    // Still allowed to shrink below its content, or a long title would push
    // the nav off the row instead of truncating. B170's table came from the
    // opposite failure and both are worth naming.
    expect(classes).toContain("min-w-0");
  });

  test("the title itself still truncates rather than overflowing", () => {
    expect(markup()).toMatch(/class="[^"]*truncate font-display/);
  });

  test("the nav's box grows, so a wrapped nav still ends at the right", () => {
    const html = markup();
    expect(html).toMatch(
      /<div class="flex w-full grow justify-end lg:w-auto lg:grow-0">/,
    );
  });

  // B285: `grow` without `lg:grow-0` competed with the title's own `grow` for
  // leftover space once the nav shared line 1 with the title and chips
  // (`lg` and up), leaving a lone chip pinned mid-row. `lg:grow-0` is the one
  // class whose absence brings that back.
  test("the nav's box stops growing once it shares the line with the title", () => {
    const html = markup();
    expect(html).toMatch(/class="[^"]*\bgrow\b[^"]*\blg:grow-0\b[^"]*"/);
  });
});

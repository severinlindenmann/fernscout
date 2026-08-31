import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MePageContent from "@/app/[user]/me/MePageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Viewer } from "@/lib/viewer";

/**
 * What the access panel offers a stranger.
 *
 * It offered the guestbook unconditionally, and a journal that keeps no
 * guestbook answers `/{user}/join` with a 404 — so the only button on the page
 * that exists to explain your access led to "this page does not exist". Both
 * doors are capabilities: a server ceiling and a journal opt-in, and either can
 * be shut.
 *
 * The rule is that a control is shown only when it can work, and when neither
 * can, the page says so in a sentence instead.
 */

// The panel renders the page header, which links and reads the path.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/me",
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
  hasAccessPanel: true,
} as unknown as SiteSummary;

const stranger: Viewer = { email: null, owner: false, guest: false, trips: [] };

function render(over: { canJoin?: boolean; canSignIn?: boolean } = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        {/* The panel draws the page header, which carries the currency and
            trip controls — so they need their providers even though nothing
            here asserts on them. */}
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
        <MePageContent
          viewer={stranger}
          username="alex"
          docUrl="https://example.test/documentation.txt"
          canJoin={over.canJoin ?? false}
          canSignIn={over.canSignIn ?? false}
        />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the access panel, for somebody not signed in", () => {
  test("with a guestbook, offers it", () => {
    const html = render({ canJoin: true });
    expect(html).toContain('href="/alex/join"');
  });

  /** The reported bug: a button whose destination answers 404. */
  test("without one, never links to a page that does not exist", () => {
    expect(render({ canJoin: false })).not.toContain("/alex/join");
  });

  test("and says why there is nothing to press", () => {
    expect(render({ canJoin: false, canSignIn: false })).toMatch(/nothing to fill in/i);
  });

  test("with sign-in available, offers the way back in", () => {
    expect(render({ canSignIn: true })).toContain("signin-email");
  });

  test("without it, does not — the endpoints would answer 404", () => {
    expect(render({ canSignIn: false })).not.toContain("signin-email");
  });

  /**
   * Somebody reading this has almost certainly been here before and lost the
   * email. Offering the sign-up form first asks them to become a second
   * person, so the guestbook is named once, quietly, underneath.
   */
  test("names the guestbook once when both are on, not twice", () => {
    const html = render({ canJoin: true, canSignIn: true });
    expect(html.split('href="/alex/join"').length - 1).toBe(1);
  });
});

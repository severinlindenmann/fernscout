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
import { CODE_TTL_MINUTES } from "@/lib/auth";

/**
 * What the access panel offers a stranger.
 *
 * Once, two things: sign-in, and the open guestbook. B37 removed the second —
 * a form anybody who found a username could fill in, putting themselves on the
 * owner's queue uninvited. What is left is one door, and it is a capability: a
 * server ceiling and a journal opt-in, either of which can be shut.
 *
 * The rule is that a control is shown only when it can work, and when none
 * can, the page says so in a sentence instead — the sentence that used to
 * appear only on a journal with no guestbook, and is now simply true.
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

function render(over: { canSignIn?: boolean } = {}) {
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
          canSignIn={over.canSignIn ?? false}
          codeMinutes={CODE_TTL_MINUTES}
        />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the access panel, for somebody not signed in", () => {
  /**
   * B37. The panel is the only place the open guestbook was ever advertised,
   * so this is the assertion that the signpost is down — whether or not the
   * journal keeps contacts, and whether or not it can issue codes.
   */
  test("never offers a way to join uninvited", () => {
    for (const canSignIn of [true, false]) {
      const html = render({ canSignIn });
      expect(html).not.toContain("/alex/join");
      // The button that opened it. ("guestbook" itself still appears, in the
      // sentence explaining that this journal does not keep one.)
      expect(html).not.toContain("Sign the guestbook");
      // And a stranger is never asked for what that form asked for. The
      // sign-in form is itself a form and wants an email address, so only the
      // postal fields separate the two.
      expect(html).not.toMatch(/postal|postcode|street/i);
    }
  });

  test("with sign-in available, offers the way back in", () => {
    expect(render({ canSignIn: true })).toContain("signin-email");
  });

  test("and nothing else: no second thing for a stranger to press", () => {
    const html = render({ canSignIn: true });
    expect(html).not.toMatch(/nothing to fill in/i);
  });

  test("without it, does not — the endpoints would answer 404", () => {
    expect(render({ canSignIn: false })).not.toContain("signin-email");
  });

  test("and then says why there is nothing to press", () => {
    expect(render({ canSignIn: false })).toMatch(/nothing to fill in/i);
  });
});

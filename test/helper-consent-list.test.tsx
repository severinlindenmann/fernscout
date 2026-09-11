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
 * The consent a journal has granted, shown on `/<user>/me` — B723.
 *
 * `docs/plans/2026-09-07-web-helper-agent.md` §6 asked for withdraw to live
 * here; B684 shipped it inside the wizard's own panel instead. This is the
 * plan's version: what was agreed to, when, and to whom, with a button.
 */

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

const owner: Viewer = { email: "owner@example.test", owner: true, guest: false, trips: [] };

function render() {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MePageContent
              viewer={owner}
              username="alex"
              siteUrl="https://example.test"
              canSignIn={false}
              codeMinutes={CODE_TTL_MINUTES}
              contactsEnabled={false}
              ownerName="Robin"
              consentAgreedAt="2026-08-01T00:00:00.000Z"
              consentRows={[{ scope: "words", provider: "Anthropic" }]}
              signupEnabled={true}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the consent list on /<user>/me", () => {
  test("shows the granted scope, its provider and a way to withdraw it", () => {
    const html = render();
    expect(html).toContain("Send my words to the model");
    expect(html).toContain("Anthropic");
    expect(html).toContain("Withdraw this permission");

    // The date is formatted from lib/i18n.ts's own month names, not
    // `toLocaleDateString` — B723 shipped with the latter and it rendered
    // "01/09/2026" on the server against "9/1/2026" in the browser, a real
    // hydration mismatch on every load of this page. A slash here means the
    // bare locale formatter is back.
    expect(html).toContain("1 August");
    expect(html).not.toMatch(/\d+\/\d+\/\d+/);
  });
});

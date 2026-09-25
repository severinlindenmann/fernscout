import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HelperConsentList from "@/components/HelperConsentList";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * `HelperConsentList` — rendered directly since B2142 moved the owner's
 * studio page to its own switch rows (`test/studio-permissions.test.tsx`);
 * the component itself still serves a buddy's `/me`. Originally B723,
 * moved there from `/<user>/me`'s own owner block by B2017 (a buddy's single
 * `sessions` row stays on `/me`, tested in `test/access-panel.test.tsx`).
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
  usePathname: () => "/alex/studio/agent",
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

function render(
  over: {
    consentAgreedAt?: string;
    consentRows?: { scope: "words" | "photos" | "speech" | "statement"; granted: boolean; provider?: string }[];
  } = {},
) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <HelperConsentList
              username="alex"
              agreedAt={"consentAgreedAt" in over ? over.consentAgreedAt : "2026-08-01T00:00:00.000Z"}
              rows={
                over.consentRows ?? [{ scope: "words", granted: true, provider: "Anthropic" }]
              }
              sessionsShared={true}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the consent list", () => {
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

  /** B1390: a journal that has never opened the wizard used to show nothing
   *  here at all — the section only rendered on a non-empty list of grants.
   *  Now the four scopes are always rows, and an ungranted one says so. */
  test("says what is not granted, on a journal that has never used the helper", () => {
    const html = render({
      consentAgreedAt: undefined,
      consentRows: [
        { scope: "words", granted: false },
        { scope: "photos", granted: false },
        { scope: "speech", granted: false },
        { scope: "statement", granted: false },
      ],
    });
    expect(html).toContain(dictionaryFor("en")["me.dataTitle"]);
    expect(html).toContain("Send my words to the model");
    expect(html).toContain(dictionaryFor("en")["me.consentNotGranted"]);
    expect(html).not.toContain("Withdraw this permission");
  });

  /** The one row this page can both grant and withdraw — B1390's whole
   *  reason for keeping the asymmetry, checked on the merged list. */
  test("the sessions row alone still carries a real switch", () => {
    const html = render({ consentAgreedAt: undefined, consentRows: [] });
    expect(html).toContain('type="checkbox"');
  });
});

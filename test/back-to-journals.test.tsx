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
 * B433 — the way back out of a journal.
 *
 * B411 gave a signed-in reader a page listing every journal they may open, and
 * opening one was a one-way trip: the header's title links to the journal's
 * own home, and nothing in the chrome pointed anywhere above it. A reader with
 * three journals had to know to edit the address bar.
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

const base: SiteSummary = {
  username: "alex",
  title: "Fernscout Demo",
  tagline: "Five journeys",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: false,
  hasIdentity: false,
  canSignIn: false,
  costsEnabled: true,
};

function markup(site: SiteSummary, locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <PageHeader />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the way back to the other journals", () => {
  test("a reader holding an identity is offered it", () => {
    const html = markup({ ...base, hasIdentity: true });
    expect(html).toContain("Your journals");
    expect(html).toMatch(/<a href="\/"[^>]*>/);
  });

  /**
   * The link is drawn from `hasIdentity` and not from `signedIn`, and the two
   * genuinely come apart: every session issued before B410, and every one a
   * journal's own `/<user>/me` form issues, is a guest session on this journal
   * with no identity behind it. Sending those readers to `/` would land them
   * on the public landing page having promised them "your journals".
   */
  test("a guest session on this journal alone is not offered it", () => {
    const html = markup({ ...base, signedIn: true, hasIdentity: false });
    expect(html).not.toContain("Your journals");
  });

  test("a stranger is not offered it", () => {
    expect(markup(base)).not.toContain("Your journals");
  });

  /** Not a mobile affordance with a desktop equivalent elsewhere: a reader is
   * equally stuck on either, so it renders at every width. `hidden` would be
   * how that regressed. */
  test("it is not hidden at any breakpoint", () => {
    const html = markup({ ...base, hasIdentity: true });
    const link = /<a href="\/" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(link).not.toMatch(/\bhidden\b/);
    expect(link).not.toMatch(/\b(sm|md|lg|xl):(inline|block|flex)\b/);
  });

  test("it speaks the reader's language", () => {
    expect(markup({ ...base, hasIdentity: true }, "de")).toContain("Deine Reisetagebücher");
  });

  /**
   * The nav row is measured twice in PageHeader's own comments and was the
   * cause of B170 and B212; seven controls already wrap onto their own line on
   * a phone. This link belongs to the title box, above the journal's name.
   */
  test("it sits in the title box rather than in the crowded nav row", () => {
    const html = markup({ ...base, hasIdentity: true });
    const back = html.indexOf("Your journals");
    const title = html.indexOf("Fernscout Demo");
    const nav = html.indexOf("<nav");
    expect(back).toBeLessThan(title);
    expect(back).toBeLessThan(nav);
  });
});

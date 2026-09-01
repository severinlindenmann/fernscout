import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MePageContent from "@/app/[user]/me/MePageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import type { SiteSummary } from "@/lib/site";
import type { Viewer } from "@/lib/viewer";
import { CODE_TTL_MINUTES } from "@/lib/auth";

/**
 * What the panel says when there is nothing to list.
 *
 * "What you can read" had one empty state and two readers. Written for the
 * guest whose invitation has not arrived — *ask whoever sent you here* — it
 * was shown unchanged to the owner of a journal with no trips in it, at the
 * first moment they looked at their own site: nobody sent them, and there is
 * nothing they could be invited to that they do not already have (B75).
 *
 * `resolveViewer` gives an owner every trip in the journal, so for them an
 * empty list means one thing only, and the panel now says it — along with how
 * a trip gets made, which per decision 24 is an agent.
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

const DOC_URL = "https://example.test/documentation.txt";

/** Signed in, and nothing to read: the owner of an empty journal. */
const owner: Viewer = { email: "owner@example.test", owner: true, guest: false, trips: [] };
/** Signed in, and nothing to read: a guest whose invitation has not arrived. */
const guest: Viewer = { email: "reader@example.test", owner: false, guest: true, trips: [] };

function render(viewer: Viewer, locale = "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MePageContent
              viewer={viewer}
              username="alex"
              docUrl={DOC_URL}
              canSignIn={true}
              codeMinutes={CODE_TTL_MINUTES}
              /* Irrelevant to the empty state, but required since B74 — the
                 owner's guest-list link is only drawn when the journal runs
                 contacts. Off, so nothing here depends on that link. */
              contactsEnabled={false}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

/** None of the strings asserted on here carry a character React escapes, so
 * they can be compared against the markup as written in the dictionary — which
 * keeps the assertions from drifting away from the copy. */
function line(locale: string, key: string): string {
  const text = dictionaryFor(locale)[key];
  expect(text, `${locale} is missing ${key}`).toBeTruthy();
  expect(text).not.toMatch(/[&<>"']/);
  return text;
}

describe("an owner whose journal has no trips", () => {
  test("is not told to ask whoever sent them here", () => {
    const html = render(owner);
    expect(html).not.toContain(line("en", "me.nothing"));
    expect(html).toContain(line("en", "me.ownerNoTrips"));
  });

  /** The new line points down the page rather than repeating the handover, so
   * what it points at has to be on the page it is shown on. */
  test("is pointed at the two lines an agent needs, which are below it", () => {
    const html = render(owner);
    expect(html).toContain(line("en", "me.ownerNoTrips"));
    expect(html).toContain(DOC_URL);
    expect(html).toContain(owner.email!);
  });

  test("hears it in every maintained locale", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(owner, locale);
      expect(html, locale).toContain(line(locale, "me.ownerNoTrips"));
      expect(html, locale).not.toContain(line(locale, "me.nothing"));
    }
  });
});

describe("a guest with nothing to read", () => {
  test("still gets the invitation sentence, unchanged", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(guest, locale);
      expect(html, locale).toContain(line(locale, "me.nothing"));
      expect(html, locale).not.toContain(line(locale, "me.ownerNoTrips"));
    }
  });
});

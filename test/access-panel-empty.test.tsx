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
 *
 * B395 added a third: `resolveViewer`'s `guest` flag is true only for a
 * confirmed contact — somebody actually invited and approved — so an empty
 * list *with* it set is not "the invitation has not arrived", it is "every
 * trip is closed to you regardless". This file used to assert the opposite:
 * that a guest with `guest: true` still got the un-invited sentence. That was
 * the bug; the fix reuses `/<user>/trips`'s own sentence for the same reader
 * (`trips.hiddenSignedInBody`) rather than inventing a third wording for it.
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

/** Signed in, and nothing to read: the owner of an empty journal. */
const owner: Viewer = { email: "owner@example.test", owner: true, guest: false, trips: [] };
/** Signed in, and nothing to read: never invited, or an invitation that has
 * not arrived — `resolveViewer` never confirmed this contact. */
const stranger: Viewer = { email: "reader@example.test", owner: false, guest: false, trips: [] };
/** Signed in, approved, and still nothing to read — every trip in this
 * journal is closed to them regardless (B395). */
const approved: Viewer = { email: "reader@example.test", owner: false, guest: true, trips: [] };

function render(viewer: Viewer, locale = "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MePageContent
              viewer={viewer}
              username="alex"
              siteUrl="https://example.test"
              canSignIn={true}
              codeMinutes={CODE_TTL_MINUTES}
              ownerName="Dara"
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
   * what it points at has to be on the page it is shown on — since B301, a
   * single button rather than two lines to hand over by hand. */
  test("is pointed at the button an agent needs, which is below it", () => {
    const html = render(owner);
    expect(html).toContain(line("en", "me.ownerNoTrips"));
    expect(html).toContain(line("en", "me.handoverCreate"));
  });

  test("hears it in every maintained locale", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(owner, locale);
      expect(html, locale).toContain(line(locale, "me.ownerNoTrips"));
      expect(html, locale).not.toContain(line(locale, "me.nothing"));
    }
  });
});

describe("somebody never invited, or not yet confirmed", () => {
  test("still gets the invitation sentence, unchanged", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(stranger, locale);
      expect(html, locale).toContain(line(locale, "me.nothing"));
      expect(html, locale).not.toContain(line(locale, "me.ownerNoTrips"));
    }
  });
});

describe("an approved reader who can see nothing — B395", () => {
  test("is not told to ask for an invitation they already have", () => {
    const html = render(approved);
    expect(html).not.toContain(line("en", "me.nothing"));
  });

  test("is told the same thing the trips page tells them, by name", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(approved, locale);
      const expected = dictionaryFor(locale)["trips.hiddenSignedInBody"].replace("{name}", "Dara");
      expect(expected, `${locale} is missing trips.hiddenSignedInBody`).toBeTruthy();
      expect(html, locale).toContain(expected);
    }
  });

  test("names the owner even when no nickname was configured", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={site}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <MePageContent
                viewer={approved}
                username="alex"
                siteUrl="https://example.test"
                canSignIn={true}
                codeMinutes={CODE_TTL_MINUTES}
                contactsEnabled={false}
              />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
    const expected = dictionaryFor("en")["trips.hiddenSignedInBody"].replace("{name}", "alex");
    expect(html).toContain(expected);
  });
});

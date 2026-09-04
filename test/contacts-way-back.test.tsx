import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * The way off the contacts page — B271.
 *
 * This is the page the approval email links into, which is the one arrival with
 * no history behind it: a fresh tab from a mail client, on a phone, where the
 * browser's own back button points at nothing. It rendered a bare `<main>` and
 * was the only page under `app/[user]/` that did, so an owner who had just
 * approved a guest had no exit but the URL bar.
 *
 * The assertions are on the header being *there* rather than on how it looks:
 * `test/page-header-title.test.tsx` and `test/site-nav.test.tsx` own its
 * contents, and what was missing here was the whole component.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/contacts",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound");
  },
}));

// Everything the page reaches for on disk or in the database. The subject is
// the composition, so the data is the least a signed-in owner can have: a
// journal with nobody in it yet.
vi.mock("@/lib/users", () => ({
  getUser: () => ({
    username: "alex",
    title: "Alex's journal",
    tagline: "Somewhere else",
    owner: { email: "alex@example.test" },
    locales: ["en"],
    defaultLocale: "en",
    baseCurrency: "CHF",
  }),
  getDefaultUsername: () => null,
}));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
vi.mock("@/lib/contacts", () => ({ listContacts: async () => [] }));
// `listInvitesWithLinks` since B281 — the page recovers each link so the owner
// can send it again, which this test does not exercise and only has to stub.
vi.mock("@/lib/contacts/invites", () => ({ listInvitesWithLinks: async () => [] }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: async () => true }));
// The trips a writing link could name. None: the subject here is the header.
vi.mock("@/lib/trips", () => ({ getTrips: () => [] }));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ url: "https://example.test" }) }));
vi.mock("@/lib/locales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/locales")>()),
  localesFor: () => ["en"],
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "Somewhere else",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  signedIn: true,
  canSignIn: true,
  costsEnabled: false,
} as unknown as SiteSummary;

/** The page as the layout hands it over: the four providers, and no trip in
 * context — `/<user>/contacts` sits outside the `(trip)` group. */
async function render(): Promise<string> {
  const { default: ContactsAdminPage } = await import("@/app/[user]/contacts/page");
  const page = await ContactsAdminPage({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(
    <SiteProvider value={site}>
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TripListProvider trips={[]}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            {page}
          </CurrencyProvider>
        </TripListProvider>
      </LocaleProvider>
    </SiteProvider>,
  );
}

describe("the owner's contacts page", () => {
  test("carries the journal header, so there is a way back", async () => {
    const html = await render();
    expect(html).toContain("<header");
    // The title in the header, linking home. `useTrip()` is null here, so
    // `PageHeader` falls back to `site.base` — the journal itself.
    expect(html).toContain('href="/alex"');
  });

  test("the skip link the header renders has something to skip to", async () => {
    const html = await render();
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
  });

  test("still renders the contacts admin itself", async () => {
    const html = await render();
    expect(html).toContain(dictionaryFor("en")["contact.adminTitle"]);
  });
});

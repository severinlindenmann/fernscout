import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import type { SiteSummary } from "@/lib/site";

/**
 * B469 — the contacts admin page's own chrome must follow the reader's
 * chosen language, not the journal's default. `app/[user]/me/page.tsx`
 * already draws this line (`uiLocale` from `requestLocale()`); this page did
 * not, and rendered `pickLocale(user.defaultLocale)` instead — a fact about
 * the journal, not about whoever is looking at the screen.
 *
 * `alex`'s journal defaults to English and also offers German; the request
 * carries a `de` cookie. Before the fix the page rendered its own English
 * strings ("Readers") regardless of the cookie.
 *
 * Locale resolution (`requestLocale` → `readerLocaleForPath` →
 * `localesFor`/`defaultLocaleFor`) reads real config off disk rather than
 * through any mockable export, which is why this test builds a real content
 * directory the way `test/reader-locale.test.tsx` does, instead of mocking
 * `@/lib/users` or `@/lib/locales`.
 */

const request = vi.hoisted(() => ({ cookieLocale: "de" as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => "/alex/contacts" }),
}));
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
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
vi.mock("@/lib/contacts", () => ({
  listContacts: async () => [
    {
      id: "c1",
      name: "Jamie",
      email: "jamie@example.test",
      // The contact's own language is a separate question and must survive
      // untouched — neither the journal default nor the reader's `de`.
      locale: "hu",
      status: "active",
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      hasPostalAddress: false,
      createdVia: "buddy",
      createdAt: "2026-01-01T00:00:00Z",
      confirmedAt: "2026-01-01T00:00:00Z",
      lastSeenAt: null,
    },
  ],
}));
vi.mock("@/lib/contacts/invites", () => ({ listInvitesWithLinks: async () => [] }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: async () => true }));
vi.mock("@/lib/trips", () => ({ getTrips: () => [] }));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ url: "https://example.test" }) }));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearLocaleCache, dictionaryFor } from "@/lib/locales";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function instance(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contacts-admin-locale-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex's journal",
      tagline: "Somewhere else",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = "de";
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "Somewhere else",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en", "de"],
  base: "/alex",
  signedIn: true,
  canSignIn: true,
  costsEnabled: false,
} as unknown as SiteSummary;

async function render(): Promise<string> {
  const { default: ContactsAdminPage } = await import("@/app/[user]/contacts/page");
  const page = await ContactsAdminPage({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(
    <SiteProvider value={site}>
      <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
        <TripListProvider trips={[]}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            {page}
          </CurrencyProvider>
        </TripListProvider>
      </LocaleProvider>
    </SiteProvider>,
  );
}

describe("the contacts admin page's own language", () => {
  test("follows the reader's chosen locale, not the journal's English default", async () => {
    instance();
    const html = await render();
    // German cookie, English-default journal: the page's own chrome must be
    // German. Before the fix this rendered "Readers" (the English string).
    expect(html).toContain(dictionaryFor("de")["contact.adminTitle"]);
    expect(html).not.toContain(dictionaryFor("en")["contact.adminTitle"]);
  });

  test("a contact's own locale is untouched by the reader's choice", async () => {
    instance();
    const html = await render();
    // The Hungarian contact's own row still says "Magyar" — its language is a
    // fact about that contact, unaffected by the reader's `de` cookie or the
    // journal's English default.
    expect(html).toContain("Magyar");
  });
});

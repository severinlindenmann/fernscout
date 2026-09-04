import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * B139 — the costs page's tab title, in the language of the page under it.
 *
 * `app/[user]/(trip)/costs/page.tsx` built its whole metadata block out of
 * English literals — `title: "Costs"` — while `CostsPageContent` rendered
 * `t("cost.title")`. On a German journal that is "Was die Reise kostet" in the
 * `<h1>` and "Costs" in the browser tab, in the reader's history, in a
 * bookmark and in every link they share. The map and gallery pages were given
 * the reader's language and this one was not; so was the *trip-scoped* costs
 * route, which is the same content behind a second address.
 *
 * B140 / B185 — and the language a reader may ask for is the journal's own.
 *
 * The two halves of one page used to narrow the `fs.locale` cookie differently:
 * the body against `user.locales` (the journal's languages) and the metadata
 * against `installedLocales()` (every language the project ships chrome for).
 * The cookie is per-instance, so a reader who picked German on one journal and
 * opened an English-only one on the same server got a German `<title>` over an
 * entirely English page. Both now go through `readerLocale`, and the case is
 * asserted here on a real page rather than only on the helper.
 */

/** What the mocked request carries — set per case, read when the page asks. */
const request = vi.hoisted(() => ({ cookieLocale: undefined as string | undefined }));

// `requestLocale` reads the locale cookie and the path header; both throw
// outside a real request scope. The path is what the *journal's* language is
// resolved from, which the sharing card follows.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => "/alex/costs" }),
}));

// The page header links and reads the path.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePathname: () => "/alex/costs",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { clearLocaleCache, dictionaryFor, readerLocale } from "@/lib/locales";
import { generateMetadata } from "@/app/[user]/(trip)/costs/page";
import CostsPageContent from "@/app/[user]/(trip)/costs/CostsPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import type { CostSummary } from "@/lib/costFormat";
import type { SiteSummary } from "@/lib/site";

const LOCALES = ["en", "de", "hu"] as const;

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

/** A journal on disk, offering exactly the languages it is given. */
function journal(opts: { locales: string[]; defaultLocale: string }): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costs-title-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: opts.defaultLocale,
      locales: opts.locales,
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

/** Enough of a summary for the page to draw its heading and standfirst. */
const summary: CostSummary = {
  baseCurrency: "CHF",
  hasBegun: true,
  total: 100,
  onTheRoad: 60,
  preparation: 40,
  perDay: 20,
  daysWithSpend: 3,
  byCategory: [],
  byCountry: [],
  byDay: [],
  items: [],
  unconverted: [],
};

const site = {
  username: "alex",
  title: "A journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  hasAccessPanel: false,
} as unknown as SiteSummary;

/** The `<h1>` the reader actually sees, rendered in the body's own locale. */
function headingOf(locale: string): string {
  const html = renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <CostsPageContent summary={summary} travellers="A" />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!match) throw new Error("the costs page rendered no <h1>");
  return decode(match[1]);
}

function decode(html: string): string {
  return html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/** The locale the layout hands the body, asked exactly as the layout asks it. */
function bodyLocale(): string {
  const user = getUser("alex");
  if (!user) throw new Error("no journal on disk");
  return readerLocale(request.cookieLocale, user.locales, user.defaultLocale);
}

async function metaFor(): Promise<{ title: string; shared: string; description: string }> {
  const meta = await generateMetadata({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  });
  return {
    title: String(meta.title),
    shared: String(meta.openGraph?.title),
    description: String(meta.description),
  };
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = undefined;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe.each(LOCALES)("a journal written in %s", (locale) => {
  test("the tab title is the heading the page renders", async () => {
    journal({ locales: [locale], defaultLocale: locale });
    const dict = dictionaryFor(locale);
    const meta = await metaFor();

    expect(meta.title).toBe(dict["cost.title"]);
    expect(headingOf(bodyLocale())).toBe(dict["cost.title"]);
    expect(meta.title).toBe(headingOf(bodyLocale()));
    // The old literal, in the tab of a journal that has never had an English
    // word on it. Named so the assertion above cannot pass by translating
    // nothing.
    if (locale !== "en") expect(meta.title).not.toBe("Costs");
  });

  test("the description is the standfirst, in this journal's language", async () => {
    journal({ locales: [locale], defaultLocale: locale });
    const meta = await metaFor();

    expect(meta.description).toBe(
      dictionaryFor(locale)["cost.subtitle"].replace("{currency}", "CHF"),
    );
    expect(meta.shared).toBe(dictionaryFor(locale)["cost.title"]);
  });
});

/**
 * The split the map page documents: the tab follows the reader, the sharing
 * card follows the journal. Only for a language the journal actually offers —
 * see below.
 */
describe("a German reader on a journal that offers German", () => {
  test("gets a German tab title and an English card", async () => {
    journal({ locales: ["en", "de"], defaultLocale: "en" });
    request.cookieLocale = "de";
    const meta = await metaFor();

    expect(meta.title).toBe(dictionaryFor("de")["cost.title"]);
    expect(meta.shared).toBe(dictionaryFor("en")["cost.title"]);
    // And the body follows the reader too, so the pair still agrees.
    expect(headingOf(bodyLocale())).toBe(meta.title);
  });
});

/** B140, B185 — the cookie is per-instance and the journal is not. */
describe("a German reader on an English-only journal", () => {
  test("gets an English tab title, because the page under it is English", async () => {
    journal({ locales: ["en"], defaultLocale: "en" });
    request.cookieLocale = "de";
    const meta = await metaFor();

    expect(bodyLocale()).toBe("en");
    expect(meta.title).toBe(dictionaryFor("en")["cost.title"]);
    expect(meta.title).not.toBe(dictionaryFor("de")["cost.title"]);
    expect(meta.title).toBe(headingOf(bodyLocale()));
  });
});

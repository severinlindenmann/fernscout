import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * B118 — the map page's heading and its tab title, in the same tense.
 *
 * B54 gave the heading a choice: "Where we've been" over a trip with days
 * written, "Where we're going" over one without. The journal-level route's
 * `generateMetadata` was left saying the first unconditionally, on the
 * reasoning that a *current* trip with no days is a brief window before the
 * first entry lands.
 *
 * It is not a brief window. `getCurrentTrip` falls back to the most recent
 * *past* trip when nothing is current, so a journal between trips whose newest
 * trip has no entries sat there indefinitely serving
 *
 *     <h1>Where we're going</h1>
 *     <title>Where we've been · …</title>
 *
 * — one page, two tenses, about one trip. This asserts the pair agrees, in
 * every language the project maintains chrome for: a fix made in `en.json`
 * alone would pass an English-only test and leave German and Hungarian
 * contradicting themselves.
 */

/** What the mocked request carries — set per case, read when the page asks. */
const request = vi.hoisted(() => ({ cookieLocale: undefined as string | undefined }));

// `requestLocale` reads the locale cookie and the path header; both throw
// outside a real request scope. The path is what `localeForPath` turns into
// the *journal's* language, which the sharing card follows.
//
// `get` is keyed by name — not just by whether *a* cookie is set — since
// B336: `generateMetadata` here now also asks `draftsVisibleTo`, which reads
// the session cookie (`fs_session`) under its own name. A name-blind mock
// handed that call the locale string back as if it were a session token,
// which then failed on `getDatabase()` — nobody in this file ever signs in,
// so every cookie but the locale one is nobody's.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "fs.locale" && request.cookieLocale
        ? { value: request.cookieLocale }
        : undefined,
  }),
  headers: async () => ({ get: () => "/alex/map" }),
}));

// The page header links and reads the path. `redirect` and `notFound` are left
// real — `lib/currentTrip` imports the first, and a missing export on the mock
// would fail the import rather than the assertion.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePathname: () => "/alex/map",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearLocaleCache, dictionaryFor } from "@/lib/locales";
import { getPlaces } from "@/lib/entries";
import { currentTripRef } from "@/lib/trips";
import { generateMetadata } from "@/app/[user]/(trip)/map/page";
import MapPageContent from "@/app/[user]/(trip)/map/MapPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import type { SiteSummary } from "@/lib/site";

const LOCALES = ["en", "de", "hu"] as const;

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function userCfg(locale: string, offers?: string[]): string {
  return JSON.stringify({
    title: "A journal",
    tagline: "t",
    owner: { name: "A B", nickname: "A" },
    startLocation: "X",
    defaultLocale: locale,
    locales: offers ?? [locale],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features: {},
  });
}

/**
 * A journal on disk with one trip, which either has a day written or does not.
 *
 * `status: past` on purpose: it is the case the ticket is about. `getCurrentTrip`
 * falls back to the most recent past trip, so this is what `/alex/map` renders
 * for a journal between trips — not a transient pre-departure state.
 */
function journal(opts: { locale: string; withDay: boolean; offers?: string[] }): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-tense-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  const trip = path.join(dir, "alex", "trips", "ridge-2026");
  fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "config.json"), userCfg(opts.locale, opts.offers));
  fs.writeFileSync(
    path.join(trip, "trip.md"),
    '---\nid: ridge-2026\ntitle: "Along the ridge"\nstart: "2026-05-01"\nend: "2026-05-10"\n' +
      "status: past\nvisibility: public\n---\n\nSomething.\n",
  );
  if (opts.withDay) {
    fs.writeFileSync(
      path.join(trip, "entries", "2026-05-02-first.md"),
      '---\ntitle: "First"\ndate: "2026-05-02"\nlocation: "Chur"\ncountry: "Switzerland"\n' +
        'countryCode: "CH"\nlat: 46.8508\nlng: 9.5320\n---\n\nA day.\n',
    );
  }
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
}

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

/**
 * The `<h1>` the reader actually sees, for the journal currently on disk.
 *
 * Rendered from the same `getPlaces` call the page makes, so the two halves of
 * the assertion are the real ones rather than a re-statement of the conditional.
 */
function headingOf(locale: string): string {
  const ref = currentTripRef("alex");
  const html = renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MapPageContent
              places={ref ? getPlaces(ref) : []}
              plan={[]}
              stats={{ tripDays: 0, places: 0, countries: 0, totalMedia: 0 }}
              reachedCount={0}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!match) throw new Error("the map page rendered no <h1>");
  return decode(match[1]);
}

/** `renderToStaticMarkup` escapes the apostrophe in "Where we've been". */
function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
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

describe.each(LOCALES)("a journal reading in %s", (locale) => {
  const dict = dictionaryFor(locale);

  test("a trip with no days: the tab title and the heading both look forward", async () => {
    journal({ locale, withDay: false });
    const meta = await metaFor();

    expect(meta.title).toBe(dict["map.titlePlanned"]);
    expect(headingOf(locale)).toBe(dict["map.titlePlanned"]);
    // The pair, stated as the ticket states it: one page, one tense.
    expect(meta.title).toBe(headingOf(locale));
    expect(meta.title).not.toBe(dict["map.title"]);
    // The description is the same claim one line down — "Tap any stop to see
    // how long we stayed", over a trip with no stops.
    expect(meta.description).toBe(dict["map.subtitlePlanned"]);
  });

  test("a trip with days: the tab title and the heading both look back", async () => {
    journal({ locale, withDay: true });
    const meta = await metaFor();

    expect(meta.title).toBe(dict["map.title"]);
    expect(headingOf(locale)).toBe(dict["map.title"]);
    expect(meta.title).toBe(headingOf(locale));
    expect(meta.description).toBe(dict["map.subtitle"]);
  });

  test("the two strings are actually different in this language", () => {
    // Otherwise the assertions above pass on a dictionary that was never
    // translated — the failure mode the ticket names by name.
    expect(dict["map.titlePlanned"]).toBeTruthy();
    expect(dict["map.titlePlanned"]).not.toBe(dict["map.title"]);
    expect(dict["map.subtitlePlanned"]).not.toBe(dict["map.subtitle"]);
  });
});

/**
 * The tense is one question; the language is a different one, and the fix must
 * not flatten them. The tab title follows the *reader* — it lands in their
 * history and their bookmarks. The sharing card follows the *journal*, because
 * whoever sees a forwarded card is not this reader and their language is not
 * knowable from this request.
 */
describe("a German reader on an English journal that offers German", () => {
  /**
   * `offers` is load-bearing and was not always there. The journal used to be
   * written as English-only, and the reader's German cookie was expected to
   * win anyway — which is precisely the defect B140 and B185 record: the tab
   * title took any language the *project* maintains, while the body took only
   * the ones this *journal* offers, so the title was German over a page that
   * was entirely English. A journal that lists German is the case this split
   * is actually about.
   */
  test("gets a German tab title and an English card, both in the planned tense", async () => {
    journal({ locale: "en", offers: ["en", "de"], withDay: false });
    request.cookieLocale = "de";
    const meta = await metaFor();

    expect(meta.title).toBe(dictionaryFor("de")["map.titlePlanned"]);
    expect(meta.shared).toBe(dictionaryFor("en")["map.titlePlanned"]);
    expect(meta.title).not.toBe(meta.shared);
  });

  test("and the same split once the trip has days", async () => {
    journal({ locale: "en", offers: ["en", "de"], withDay: true });
    request.cookieLocale = "de";
    const meta = await metaFor();

    expect(meta.title).toBe(dictionaryFor("de")["map.title"]);
    expect(meta.shared).toBe(dictionaryFor("en")["map.title"]);
  });
});

/** And on a journal that does not offer it, the cookie does not apply. B140. */
describe("a German reader on an English-only journal", () => {
  test("gets an English tab title, matching the page under it", async () => {
    journal({ locale: "en", withDay: true });
    request.cookieLocale = "de";
    const meta = await metaFor();

    expect(meta.title).toBe(dictionaryFor("en")["map.title"]);
    expect(meta.title).toBe(headingOf("en"));
    expect(meta.title).not.toBe(dictionaryFor("de")["map.title"]);
  });
});

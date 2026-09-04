import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B140 / B185 — one page, one language.
 *
 * Two places decided which language a request renders in, and they asked
 * different questions:
 *
 *   - the **body**, in `app/[user]/layout.tsx`, narrowed the `fs.locale`
 *     cookie to `user.locales` — the languages this journal offers;
 *   - the **metadata**, through `requestLocale()`, narrowed it to
 *     `installedLocales()` — every language the *project* ships chrome for.
 *
 * The cookie is per-instance and a journal is not, so a reader who picked
 * German on one journal and then opened an English-only one on the same server
 * got a German `<title>` — "Wohin wir wollen", "Dein Zugang" — over an
 * entirely English page. Observed live on `/xydhd-qa3/me`.
 *
 * Both now go through `readerLocale`, and `readerLocaleForPath` is the one
 * place that decides which set to narrow against. This asserts the rule, and
 * asserts it again through a real page's `generateMetadata`, because the two
 * halves living in different files is what let them drift in the first place.
 */

const request = vi.hoisted(() => ({
  cookieLocale: undefined as string | undefined,
  path: "/alex/gallery",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => request.path }),
}));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import {
  clearLocaleCache,
  dictionaryFor,
  instanceLocale,
  readerLocale,
  readerLocaleForPath,
  requestLocale,
} from "@/lib/locales";
import { generateMetadata as galleryMetadata } from "@/app/[user]/(trip)/gallery/page";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function userCfg(locales: string[], defaultLocale: string): string {
  return JSON.stringify({
    title: "A journal",
    tagline: "t",
    owner: { name: "A B", nickname: "A" },
    startLocation: "X",
    defaultLocale,
    locales,
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features: {},
  });
}

/**
 * Two journals on one instance, which is where this shows up at all: `alex`
 * writes only English, `mila` writes German and English.
 */
function instance(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reader-locale-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  for (const [name, cfg] of [
    ["alex", userCfg(["en"], "en")],
    ["mila", userCfg(["de", "en"], "de")],
  ] as const) {
    fs.mkdirSync(path.join(dir, name, "trips"), { recursive: true });
    fs.writeFileSync(path.join(dir, name, "config.json"), cfg);
  }
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
}

/** The layout's own expression, called the way the layout calls it. */
function bodyLocale(username: string): string {
  const user = getUser(username);
  if (!user) throw new Error(`no journal ${username}`);
  return readerLocale(request.cookieLocale, user.locales, user.defaultLocale);
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = undefined;
  request.path = "/alex/gallery";
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe("the language a request resolves to", () => {
  test("a cookie the journal does not offer is not honoured", () => {
    instance();
    expect(readerLocaleForPath("/alex/gallery", "de")).toBe("en");
    expect(readerLocaleForPath("/alex/gallery", "de")).toBe(bodyLocaleFor("alex", "de"));
  });

  test("a cookie the journal does offer still is", () => {
    instance();
    expect(readerLocaleForPath("/mila/gallery", "en")).toBe("en");
    expect(readerLocaleForPath("/mila/gallery", "de")).toBe("de");
    expect(readerLocaleForPath("/mila/gallery", undefined)).toBe("de");
  });

  test("no cookie is the journal's own default, whichever journal it is", () => {
    instance();
    expect(readerLocaleForPath("/alex", undefined)).toBe("en");
    expect(readerLocaleForPath("/mila/trips/x", undefined)).toBe("de");
  });

  /**
   * Outside a journal there is no `user.locales` to narrow against — the
   * landing page, `/welcome`, the notices, a 404 for an address that names
   * nobody — so the maintained set stands in and the reader's choice counts.
   */
  test("outside a journal the reader's choice still counts", () => {
    instance();
    expect(readerLocaleForPath("/", "de")).toBe("de");
    expect(readerLocaleForPath("/nobody", "hu")).toBe("hu");
    expect(readerLocaleForPath("/welcome", undefined)).toBe(instanceLocale());
    // A language the project ships no chrome for is not an interface language.
    expect(readerLocaleForPath("/", "hr")).toBe(instanceLocale());
  });

  test("requestLocale is that rule, with the cookie and the header read for it", async () => {
    instance();
    request.cookieLocale = "de";
    request.path = "/alex/gallery";
    expect(await requestLocale()).toBe("en");
    request.path = "/mila/gallery";
    expect(await requestLocale()).toBe("de");
  });
});

/** The same, through a page — this is where it was seen. */
describe("a German reader landing on an English-only journal", () => {
  test("the tab title is in the language the page will render in", async () => {
    instance();
    request.cookieLocale = "de";
    request.path = "/alex/gallery";
    const meta = await galleryMetadata();

    expect(bodyLocale("alex")).toBe("en");
    expect(String(meta.title)).toBe(dictionaryFor("en")["gallery.title"]);
    expect(String(meta.title)).not.toBe(dictionaryFor("de")["gallery.title"]);
  });

  test("and on a journal that does offer German, German survives", async () => {
    instance();
    request.cookieLocale = "de";
    request.path = "/mila/gallery";
    const meta = await galleryMetadata();

    expect(bodyLocale("mila")).toBe("de");
    expect(String(meta.title)).toBe(dictionaryFor("de")["gallery.title"]);
    // The sharing card is the journal's, not the reader's, and stays so.
    expect(String(meta.openGraph?.title)).toBe(dictionaryFor("de")["gallery.title"]);
  });
});

function bodyLocaleFor(username: string, cookie: string | undefined): string {
  const previous = request.cookieLocale;
  request.cookieLocale = cookie;
  try {
    return bodyLocale(username);
  } finally {
    request.cookieLocale = previous;
  }
}

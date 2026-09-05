import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * B225 — the front door's tab title, in the language of the page under it.
 *
 * `/` with `Cookie: fs.locale=de` served
 *
 *     <html lang="de">
 *     <title>Fernscout — a travel journal your agent writes</title>
 *     <h1>Ein Reisetagebuch, das dein Agent für dich schreibt.</h1>
 *
 * and served the *same* English title under `fs.locale=hr`, where the page
 * genuinely is English — which is the tell: the title was not locale-dependent
 * at all. This is the third page to show that symptom and the first where the
 * locale resolution was already right (B118 was a tense, B140/B185 were two
 * rules for one question); the landing page's metadata simply had no
 * translated string to render into.
 *
 * The `<h1>` is rendered here rather than restated, so the two halves of each
 * assertion are the ones a reader actually gets.
 */

const request = vi.hoisted(() => ({
  cookieLocale: undefined as string | undefined,
  path: "/",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (request.cookieLocale ? { value: request.cookieLocale } : undefined),
  }),
  headers: async () => ({ get: () => request.path }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The language switcher refreshes the route so the server re-reads the cookie.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearLocaleCache, dictionaryFor, instanceLocale, installedLocales } from "@/lib/locales";
import { generateMetadata as landingMetadata } from "@/app/page";
import { generateMetadata as offlineMetadata } from "@/app/offline/page";
import Landing from "@/components/Landing";
import LocaleProvider from "@/components/LocaleProvider";

const SITE_NAME = "Fernscout";

/**
 * An instance whose own language is English, with one journal on it.
 *
 * English on purpose: it makes a German or Hungarian title something only the
 * reader's cookie can have produced.
 */
function instance(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "landing-meta-"));
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: SITE_NAME, url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
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

/** The `<h1>` the reader sees on `/`, in the language the request resolved to. */
function headingOf(locale: string): string {
  const html = renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <Landing
        siteName={SITE_NAME}
        docUrl="https://example.test/documentation.txt"
        agentUrl="https://example.test/agent.md"
        codeMinutes="30"
      journals={[]}
      />
    </LocaleProvider>,
  );
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!match) throw new Error("the landing page rendered no <h1>");
  return match[1].replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

async function titleOf(): Promise<string> {
  const meta = await landingMetadata();
  const title = meta.title;
  // `absolute`, so the root layout's `%s · Fernscout` template does not append
  // the site name to a sentence that already carries it.
  if (!title || typeof title !== "object" || !("absolute" in title)) {
    throw new Error(`the landing title is not absolute: ${JSON.stringify(title)}`);
  }
  return String(title.absolute);
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  request.cookieLocale = undefined;
  request.path = "/";
  clearConfigCache();
  clearUserCache();
  clearLocaleCache();
});

describe.each(installedLocales())("the front door read in %s", (locale) => {
  test("the tab title and the heading are in the same language", async () => {
    instance();
    request.cookieLocale = locale;
    const dict = dictionaryFor(locale);

    expect(await titleOf()).toBe(
      dict["landing.metaTitle"].replace("{name}", SITE_NAME),
    );
    expect(headingOf(locale)).toBe(dict["landing.hero"]);
    expect(String((await landingMetadata()).description)).toBe(dict["landing.metaDescription"]);
  });

  test("the instance's name is in the title, not a stray placeholder", async () => {
    instance();
    request.cookieLocale = locale;

    const title = await titleOf();
    expect(title).toContain(SITE_NAME);
    expect(title).not.toContain("{name}");
  });
});

describe("the strings are actually translated", () => {
  /**
   * Otherwise the assertions above pass on a dictionary nobody translated —
   * which is the defect itself, moved one file across.
   */
  test("each maintained language says something different", () => {
    const titles = installedLocales().map((code) => dictionaryFor(code)["landing.metaTitle"]);
    const blurbs = installedLocales().map(
      (code) => dictionaryFor(code)["landing.metaDescription"],
    );
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });
});

/**
 * The other half of B140's rule, restated for a page with no journal: a
 * language this project ships no chrome for is not an interface language, so
 * the reader gets the instance's own — in the title exactly as in the body.
 * This is the case that exposed the bug, because here the old English title
 * was *right* and could not be told from the wrong one.
 */
describe("a reader whose language the instance does not maintain", () => {
  test("gets the instance's own language in the title and the heading alike", async () => {
    instance();
    request.cookieLocale = "hr";

    expect(instanceLocale()).toBe("en");
    expect(await titleOf()).toBe(
      dictionaryFor("en")["landing.metaTitle"].replace("{name}", SITE_NAME),
    );
    expect(headingOf(instanceLocale())).toBe(dictionaryFor("en")["landing.hero"]);
  });
});

/**
 * B225's third acceptance line, asked of every page that belongs to no
 * journal. `/welcome` is not among them: it is a `redirect("/")` and renders
 * no document at all.
 *
 * The 404 is deliberately not asserted here, still. It used to carry its own
 * `generateMetadata` that returned a translated title when called directly —
 * and Next never called it, because `not-found.js` has no metadata export in
 * its API surface, so the served page took the root layout's `title.default`
 * and said "Fernscout" in every language regardless. A unit test calling that
 * function would have passed while the real response stayed wrong, which is
 * the whole failure mode B225 is about — so B251 deleted the dead export and
 * moved the translated fallback into `app/layout.tsx`'s own `title.default`,
 * proved against a real production build with curl instead of a direct call,
 * for the same reason.
 */
describe("every page outside a journal", () => {
  test("has a title in the reader's language, not an English literal", async () => {
    instance();
    request.cookieLocale = "de";
    const de = dictionaryFor("de");

    request.path = "/";
    expect(await titleOf()).toBe(de["landing.metaTitle"].replace("{name}", SITE_NAME));

    request.path = "/offline";
    expect(String((await offlineMetadata()).title)).toBe(de["err.offlineTitle"]);
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { default as proxy } from "@/proxy";
import { LANGUAGE_PAGES, languageAlternates, languageHref, splitLanguagePath } from "@/lib/languagePaths";
import { LOCALE_COOKIE, PATH_HEADER, PATH_LOCALE_HEADER } from "@/lib/requestKeys";
import { pagesSitemap } from "@/lib/sitemap";

/**
 * B2473 — a German page has a German address. A crawler sends no cookie and
 * no Accept-Language, so the only way it reads German is an address that is
 * German: /de/schools. The path wins, the root stays English for crawlers
 * (and follows the reader for people), and every version names every other.
 */

const request = { headers: new Map<string, string>(), cookie: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (request.cookie ? { value: request.cookie } : undefined) }),
  headers: async () => ({ get: (name: string) => request.headers.get(name.toLowerCase()) ?? null }),
}));

function get(url: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(new URL(url, "https://example.test"), { headers });
  return { req, res: proxy(req) };
}

describe("language addresses", () => {
  test("/de/schools is /schools in German", () => {
    expect(splitLanguagePath("/de/schools")).toEqual({ locale: "de", path: "/schools" });
    expect(splitLanguagePath("/fr")).toEqual({ locale: "fr", path: "/" });
    expect(splitLanguagePath("/de/legal")).toEqual({ locale: "de", path: "/legal" });
  });

  test("only pages whose words exist in that language have one", () => {
    expect(splitLanguagePath("/fr/legal")).toBeNull();
    expect(splitLanguagePath("/de/docs/api")).toBeNull();
    expect(splitLanguagePath("/de/example")).toBeNull();
    expect(splitLanguagePath("/hu/schools")).toBeNull();
    expect(splitLanguagePath("/en/schools")).toBeNull();
  });

  test("links keep the language, and leave pages without a version alone", () => {
    expect(languageHref("de", "/schools/demo")).toBe("/de/schools/demo");
    expect(languageHref("de", "/")).toBe("/de");
    expect(languageHref("de", "/#journals")).toBe("/de#journals");
    expect(languageHref("fr", "/legal")).toBe("/legal");
    expect(languageHref("de", "/example")).toBe("/example");
    expect(languageHref(null, "/schools")).toBe("/schools");
  });

  test("hreflang: de-CH and de, fr-CH and fr, it-CH and it, en and x-default", () => {
    expect(languageAlternates("/schools")).toEqual({
      "de-CH": "/de/schools",
      de: "/de/schools",
      "fr-CH": "/fr/schools",
      fr: "/fr/schools",
      "it-CH": "/it/schools",
      it: "/it/schools",
      en: "/schools",
      "x-default": "/schools",
    });
    expect(languageAlternates("/legal", ["de", "en"])).toEqual({
      "de-CH": "/de/legal",
      de: "/de/legal",
      en: "/legal",
      "x-default": "/legal",
    });
  });
});

describe("the proxy", () => {
  test("rewrites a language address and says which language it asked for", () => {
    const { req, res } = get("/de/schools/demo", { cookie: `${LOCALE_COOKIE}=fr`, "accept-language": "it" });
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://example.test/schools/demo");
    expect(req.headers.get(PATH_LOCALE_HEADER)).toBe("de");
    expect(req.headers.get(PATH_HEADER)).toBe("/schools/demo");
  });

  test("a client cannot claim the language header itself", () => {
    const { req } = get("/schools", { [PATH_LOCALE_HEADER]: "de" });
    expect(req.headers.get(PATH_LOCALE_HEADER)).toBeNull();
  });

  test("?lang=de on a page with a German address is a 301 there, cookie kept", () => {
    const { res } = get("/schools?lang=de&x=1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://example.test/de/schools?x=1");
    expect(res.cookies.get(LOCALE_COOKIE)?.value).toBe("de");
    expect(get("/?lang=fr").res.headers.get("location")).toBe("https://example.test/fr");
  });

  test("?lang= where there is no such address behaves as it always did", () => {
    for (const url of ["/legal?lang=fr", "/schools?lang=hu", "/example?lang=de"]) {
      const { res } = get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("location"), url).toBeNull();
    }
  });

  test("the root address says it varies by the reader's language", () => {
    expect(get("/schools").res.headers.get("vary")).toContain("Accept-Language");
  });
});

describe("metadata", () => {
  beforeEach(() => {
    request.headers.clear();
    request.cookie = undefined;
  });

  test("/de/schools is German, canonical to itself, with the full set", async () => {
    request.headers.set(PATH_LOCALE_HEADER, "de");
    request.headers.set(PATH_HEADER, "/schools");
    request.cookie = "en";
    const { requestLocale } = await import("@/lib/locales");
    expect(await requestLocale()).toBe("de");
    const { generateMetadata } = await import("@/app/schools/page");
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe("/de/schools");
    expect(meta.alternates?.languages).toEqual(languageAlternates("/schools"));
    // B2488 — and links its Markdown version in the same language.
    expect(meta.alternates?.types).toEqual({ "text/markdown": "/de/schools.md" });
    expect(String((meta.title as { absolute: string }).absolute)).toMatch(/Klassenlager|Schul/);
  });

  test("the root stays canonical to itself in whatever language it rendered", async () => {
    request.headers.set(PATH_HEADER, "/schools");
    request.cookie = "de";
    const { generateMetadata } = await import("@/app/schools/page");
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe("/schools");
  });
});

describe("the sitemap", () => {
  test("every language version is listed, and every alternate is reciprocal", () => {
    const pages = pagesSitemap();
    const byUrl = new Map(pages.map((p) => [p.url, p]));
    const withAlternates = pages.filter((p) => p.alternates);
    expect(withAlternates.length).toBeGreaterThan(4);
    for (const page of withAlternates) {
      const own = Object.values(page.alternates!);
      expect(own, page.url).toContain(page.url);
      for (const href of own) {
        const other = byUrl.get(href);
        expect(other, `${href} listed from ${page.url}`).toBeDefined();
        expect(other!.alternates, href).toEqual(page.alternates);
      }
    }
  });

  test("the German imprint is there and no French one is", () => {
    const urls = pagesSitemap().map((p) => p.url);
    expect(urls.some((u) => u.endsWith("/de/legal"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/fr/legal"))).toBe(false);
    expect(urls.some((u) => /\/de\/docs\/./.test(u))).toBe(false);
  });

  test("every listed language page is one the proxy rewrites", () => {
    for (const path of Object.keys(LANGUAGE_PAGES)) {
      for (const locale of LANGUAGE_PAGES[path]) {
        expect(splitLanguagePath(languageHref(locale, path))).toEqual({ locale, path });
      }
    }
  });
});

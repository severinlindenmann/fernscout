import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { default as proxy } from "@/proxy";
import { GET } from "@/app/api/page-md/route";
import { markdownHref, splitMarkdownPath } from "@/lib/languagePaths";
import { translateIn } from "@/lib/locales";
import { PATH_HEADER, PATH_LOCALE_HEADER } from "@/lib/requestKeys";

/**
 * B2488 — the landing (and, with paid/, the plans and the orgs pages) have a
 * Markdown version at `<page>.md` and at the page's own address for
 * `Accept: text/markdown`, in every language the page has, from the same
 * strings as the page.
 */

function viaProxy(url: string, accept?: string) {
  const req = new NextRequest(new URL(url, "https://example.test"), { headers: accept ? { accept } : {} });
  return proxy(req);
}

function rewrite(url: string, accept?: string): string | null {
  return viaProxy(url, accept).headers.get("x-middleware-rewrite");
}

describe("the addresses", () => {
  test("one .md address per page and language", () => {
    expect(markdownHref(null, "/")).toBe("/index.md");
    expect(markdownHref("de", "/")).toBe("/de/index.md");
    expect(markdownHref("fr", "/schools")).toBe("/fr/schools.md");
    expect(splitMarkdownPath("/de/index.md")).toEqual({ locale: "de", path: "/" });
    expect(splitMarkdownPath("/schools/demo.md")).toEqual({ locale: null, path: "/schools/demo" });
    for (const bad of ["/de.md", "/schools/index.md", "/docs.md", "/de/docs.md", "/hu/schools.md", "/example.md"]) {
      expect(splitMarkdownPath(bad), bad).toBeNull();
    }
  });

  test("the proxy sends .md and Accept: text/markdown to the Markdown route", () => {
    expect(rewrite("/de/schools.md")).toBe("https://example.test/api/page-md?path=%2Fschools&lang=de");
    expect(rewrite("/index.md")).toBe("https://example.test/api/page-md?path=%2F");
    expect(rewrite("/de/schools", "text/markdown, text/html;q=0.8")).toBe(
      "https://example.test/api/page-md?path=%2Fschools&lang=de",
    );
    const res = viaProxy("/", "text/markdown");
    expect(res.headers.get("vary")).toContain("Accept");
  });

  test("a browser still gets the page", () => {
    const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    expect(rewrite("/schools", browser)).toBeNull();
    expect(rewrite("/de/schools", browser)).toBe("https://example.test/schools");
  });

});

describe("the route", () => {
  const get = (path: string, lang?: string) =>
    GET(new Request(`https://example.test/api/page-md?path=${encodeURIComponent(path)}${lang ? `&lang=${lang}` : ""}`));

  test("the landing in German: the page's headline and sections, as Markdown", async () => {
    const res = await get("/", "de");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("vary")).toBe("Accept");
    expect(res.headers.get("link")).toMatch(/\/de>; rel="canonical"$/);
    const text = await res.text();
    expect(text.startsWith(`# ${translateIn("de", "landing.hero")}\n`)).toBe(true);
    for (const key of ["landing.howTitle", "landing.faqTitle", "landing.trustPrivateTitle", "landing.faqAppQ"] as const) {
      expect(text, key).toContain(translateIn("de", key));
    }
  });

  test("behind the proxy's rewrite it reads the page from the headers", async () => {
    const res = await GET(
      new Request("https://example.test/de/schools.md", {
        headers: { [PATH_HEADER]: "/", [PATH_LOCALE_HEADER]: "fr" },
      }),
    );
    expect(await res.text()).toContain(`# ${translateIn("fr", "landing.hero")}`);
  });

  test("English at the root, whatever else", async () => {
    const text = await (await get("/")).text();
    expect(text).toContain(`# ${translateIn("en", "landing.hero")}`);
  });

  test("no Markdown for a page or language that has none", async () => {
    expect((await get("/docs")).status).toBe(404);
    expect((await get("/", "hu")).status).toBe(404);
    expect((await get("/legal", "de")).status).toBe(404);
  });
});

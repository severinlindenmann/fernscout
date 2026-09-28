import { pricesMarkdown } from "@paid/credits/lib/markdown";
import { guideMarkdown } from "@paid/guides/lib/markdown";
import { orgsMarkdown } from "@paid/orgs/lib/markdown";
import { isEnabled } from "@/lib/capabilities";
import { landingMarkdown } from "@/lib/landingMarkdown";
import { LANGUAGE_PAGES, MARKDOWN_PAGES, isPathLocale, languageHref } from "@/lib/languagePaths";
import { PATH_HEADER, PATH_LOCALE_HEADER } from "@/lib/requestKeys";
import { serverSite } from "@/lib/site";

/**
 * The Markdown version of a page — B2488.
 *
 * Reached through the proxy, never linked by this address: `/schools.md`,
 * `/de/schools.md` and `/index.md`, or the page's own address asked with
 * `Accept: text/markdown`, arrive here as `?path=/schools&lang=de`. Built
 * from the same strings and lists as the page, in the language of the
 * address — English at the root, whatever a cookie says, because an agent's
 * fetch should get the same answer every time. `Link: rel=canonical` names
 * the HTML page, so a search engine keeps the page and not its twin.
 */
function markdownFor(path: string, locale: string): string | null {
  if (path === "/") return landingMarkdown(locale);
  if (path === "/prices") return isEnabled("credits") ? pricesMarkdown(locale) : null;
  if (path.startsWith("/guides/")) return guideMarkdown(path, locale);
  return orgsMarkdown(path, locale);
}

export function GET(request: Request): Response {
  // The proxy's headers when it rewrote `/de/schools.md` here; the query
  // when this address is asked directly.
  const params = new URL(request.url).searchParams;
  const fromProxy = request.headers.get(PATH_HEADER);
  const path = (fromProxy ?? params.get("path")) || "";
  const lang = fromProxy ? request.headers.get(PATH_LOCALE_HEADER) : params.get("lang");
  const offered = lang ? isPathLocale(lang) && LANGUAGE_PAGES[path]?.includes(lang) : true;
  const text = MARKDOWN_PAGES.includes(path) && offered ? markdownFor(path, lang ?? "en") : null;
  if (!text) {
    return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const page = `${serverSite().url}${languageHref(lang, path)}`;
  return new Response(text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Language": lang ?? "en",
      Vary: "Accept",
      Link: `<${page}>; rel="canonical"`,
    },
  });
}

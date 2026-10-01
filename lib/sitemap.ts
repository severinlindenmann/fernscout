import "server-only";
import { getAllEntries, getDays } from "./entries";
import { getCurrentTrip, getTrips } from "./trips";
import { isIndexable } from "./access";
import { analyticsCardsFor } from "./analytics";
import { serverSite } from "./site";
import { listedUsernames } from "./users";
import { DOCS_PAGES } from "./docs";
import { hasLegal, legalLocales } from "./legal";
import { LANGUAGE_PAGES, MARKDOWN_PAGES, languageAlternates, markdownHref } from "./languagePaths";
import { GUIDE_PATHS } from "@paid/guides/lib/paths";
import { SKILL_DOC_SLUGS, skillDocPath } from "./api/skillDocMeta";
import { PAID_AREAS } from "@paid/manifest";
import { isEnabled } from "./capabilities";

import { journalPath } from "./journalPath";
/**
 * The sitemap, as an index of three — B2486.
 *
 * `/sitemap.xml` is the index (the URL Search Console already holds) and it
 * names one child per kind of page: the instance's own pages, the public
 * journals, and the documents written for agents. Each child is built here
 * as plain data and serialised by `urlsetXml`, so the rules — what is listed,
 * with which date — are testable without a server.
 *
 * **Only what anybody may open.** Journals come from `listedUsernames()` (a
 * guest-only journal asked not to be advertised) and trips from
 * `isIndexable`; entries are read with no reader, which is the public view,
 * so a draft or a held-back update is never named. Nothing here reads GPS.
 *
 * **Dates are the content's.** A day's `lastmod` is the day's own date and a
 * trip's is its newest day's. The instance's pages carry none — a date that
 * is only "when this request ran" tells a crawler nothing, and the audit that
 * opened this ticket found exactly that on every entry.
 *
 * **Languages.** A page's language versions go in `alternates` as
 * `hreflang → URL`. Nothing sets them today: journal languages are a `?lang=`
 * parameter whose pages canonicalise to the bare URL, so listing them as
 * alternates argued with the canonical. The instance pages with language
 * addresses (B2473) get them in `instancePage` below.
 */

export type SitemapEntry = {
  url: string;
  /** yyyy-mm-dd, from the content. */
  lastmod?: string;
  /** hreflang → absolute URL, the entry's own language included. */
  alternates?: Record<string, string>;
  /** Absolute photograph URLs shown on the page. */
  images?: string[];
};

export const SITEMAPS = ["pages", "journals", "agents"] as const;

/**
 * One instance page, and its language addresses (B2473) as entries of their
 * own: every version lists every version, itself included, so the set is
 * reciprocal. `/legal` offers only the languages its imprint is written in.
 */
function instancePage(base: string, path: string): SitemapEntry[] {
  const offered = path === "/legal" ? legalLocales() : LANGUAGE_PAGES[path];
  if (!offered) return [{ url: `${base}${path}` }];
  const alternates = Object.fromEntries(
    Object.entries(languageAlternates(path, offered)).map(([lang, href]) => [lang, `${base}${href === "/" ? "" : href}`]),
  );
  const urls = [...new Set(Object.values(alternates))];
  return urls.map((url) => ({ url, alternates }));
}

/** The landing, /agentic, the orgs pages and their demos, the docs and the imprint. */
export function pagesSitemap(): SitemapEntry[] {
  const base = serverSite().url;
  const paths = ["", "/agentic", "/docs", ...DOCS_PAGES.map((p) => p.href)];
  // The schools and tour-operator pages exist only where paid/ does — B2450.
  if (PAID_AREAS.includes("orgs")) {
    paths.push("/schools", "/schools/demo", "/tour-operators", "/tour-operators/demo");
  }
  // The plans side by side — B2509. Only where this instance charges; the
  // page itself is a 404 otherwise.
  if (isEnabled("billing")) paths.push("/prices");
  if (hasLegal()) paths.push("/legal");
  // The answer pages — B2489. Empty without paid/.
  paths.push(...GUIDE_PATHS);
  return paths.flatMap((path) => instancePage(base, path === "" ? "/" : path));
}

/** A photograph's absolute URL, for the ones this server serves itself. */
function imageUrl(base: string, src: string): string | null {
  if (/^https?:/.test(src)) return null;
  return `${base}${src}`;
}

/** Every public trip and day, with their dates and photographs. */
export function journalsSitemap(): SitemapEntry[] {
  const base = serverSite().url;
  const out: SitemapEntry[] = [];

  for (const username of listedUsernames()) {
    const trips = getTrips(username).filter(isIndexable);
    if (trips.length === 0) continue;

    const currentId = getCurrentTrip(username)?.id;
    const latest = trips
      .map((trip) => getDays(trip.ref).at(-1)?.date)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1);
    out.push({ url: `${base}${journalPath(username)}`, lastmod: latest });
    out.push({ url: `${base}${journalPath(username)}/trips`, lastmod: latest });

    for (const trip of trips) {
      const isCurrent = trip.id === currentId;
      const tripBase = isCurrent ? `${base}${journalPath(username)}` : `${base}${journalPath(username)}/trips/${trip.id}`;
      const lastmod = getDays(trip.ref).at(-1)?.date ?? trip.end;

      if (!isCurrent) out.push({ url: tripBase, lastmod });
      // A trip that has not begun has no gallery, map, costs or days worth
      // offering a crawler. `upcoming` is derived from `start` (B72).
      if (trip.status === "upcoming") continue;

      // The pages the crawler is offered are exactly the pages that answer
      // 200: no costs page without costs (B165, B267), no weather without
      // weather (B557).
      const cards = analyticsCardsFor(username, trip.ref);
      const pages = ["/gallery", "/map"];
      if (cards.costs || cards.weather) pages.push("/analytics");
      if (cards.costs) pages.push("/costs");
      if (cards.weather) pages.push("/weather");
      for (const page of pages) out.push({ url: `${tripBase}${page}`, lastmod });

      for (const entry of getAllEntries(trip.ref)) {
        // A test day inside a real trip is not offered to a crawler. A whole
        // test trip never reached here — `isIndexable` above.
        if (entry.test) continue;
        const images = entry.gallery
          .filter((g) => g.type === "image")
          .map((g) => imageUrl(base, g.src))
          .filter((u): u is string => u !== null);
        out.push({
          url: `${tripBase}/day/${entry.slug}`,
          lastmod: entry.date,
          ...(images.length > 0 ? { images } : {}),
        });
      }
    }
  }
  return out;
}

/**
 * The pages whose Markdown version answers on this build — B2488: the
 * orgs pages only with paid/, /prices only where this instance charges.
 */
export function markdownPages(): string[] {
  return MARKDOWN_PAGES.filter((path) => {
    if (path === "/prices") return isEnabled("billing");
    if (path.startsWith("/schools") || path.startsWith("/tour-operators")) return PAID_AREAS.includes("orgs");
    return true;
  });
}

/**
 * What an agent reads: llms.txt, the task guides, the API, and the pages'
 * Markdown versions in every language they have (B2488). Not
 * `/documentation.txt` — it answers `X-Robots-Tag: noindex` on purpose, and a
 * sitemap entry for it would argue with that; llms.txt links it instead.
 */
export function agentsSitemap(): SitemapEntry[] {
  const base = serverSite().url;
  return [
    "/llms.txt",
    ...SKILL_DOC_SLUGS.map(skillDocPath),
    "/api/v2/openapi.json",
    ...markdownPages().flatMap((path) => [null, ...(LANGUAGE_PAGES[path] ?? [])].map((l) => markdownHref(l, path))),
  ].map((path) => ({ url: `${base}${path}` }));
}

export function sitemapFor(name: string): SitemapEntry[] | null {
  if (name === "pages") return pagesSitemap();
  if (name === "journals") return journalsSitemap();
  if (name === "agents") return agentsSitemap();
  return null;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const body = entries.map((e) => {
    const lines = [`<loc>${escapeXml(e.url)}</loc>`];
    if (e.lastmod) lines.push(`<lastmod>${e.lastmod}</lastmod>`);
    for (const [lang, href] of Object.entries(e.alternates ?? {})) {
      lines.push(`<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(href)}"/>`);
    }
    for (const src of e.images ?? []) {
      lines.push(`<image:image><image:loc>${escapeXml(src)}</image:loc></image:image>`);
    }
    return `<url>${lines.join("")}</url>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:xhtml="http://www.w3.org/1999/xhtml" ' +
    'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    body.join("\n") +
    "\n</urlset>\n"
  );
}

/** The index at /sitemap.xml: one child per kind, at /sitemap/<name>.xml. */
export function sitemapIndexXml(): string {
  const base = serverSite().url;
  const body = SITEMAPS.map((name) => `<sitemap><loc>${escapeXml(`${base}/sitemap/${name}.xml`)}</loc></sitemap>`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body.join("\n") +
    "\n</sitemapindex>\n"
  );
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

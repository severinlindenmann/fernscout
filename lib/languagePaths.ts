import { GUIDE_PATHS } from "@paid/guides/lib/paths";

/**
 * Language addresses — B2473.
 *
 * A page whose words exist in German, French or Italian has an address of
 * its own in that language: `/de/schools`, `/fr/schools`, `/it/schools`.
 * English stays at the root with no prefix, and is the x-default. The slugs
 * stay English. The proxy rewrites `/de/schools` to `/schools` and tells the
 * page, in a header, which language the address asked for — so the path wins
 * over a cookie and over `Accept-Language`, and a crawler that sends neither
 * still reads German at the German address.
 *
 * Only pages whose content really exists in a language are listed here. The
 * docs subpages are English text and journals are one URL each in their
 * owner's language, so neither is. No imports but data: the proxy and the
 * language switcher (a client component) both read this.
 */
export const PATH_LOCALES = ["de", "fr", "it"] as const;
export type PathLocale = (typeof PATH_LOCALES)[number];

const ALL: readonly PathLocale[] = PATH_LOCALES;

/** Every page with language addresses, and the languages it has them in.
 * A page that does not exist on this build (the orgs pages without paid/,
 * /prices without credits, /legal without an imprint) still answers 404 at
 * its language address — the page itself decides, exactly as at the root. */
export const LANGUAGE_PAGES: Readonly<Record<string, readonly PathLocale[]>> = {
  "/": ALL,
  "/docs": ALL,
  "/prices": ALL,
  "/schools": ALL,
  "/schools/demo": ALL,
  "/tour-operators": ALL,
  "/tour-operators/demo": ALL,
  // The imprint is written in English and German only (site/legal/).
  "/legal": ["de"],
  ...Object.fromEntries(GUIDE_PATHS.map((p) => [p, ALL])),
};

export function isPathLocale(value: string | undefined): value is PathLocale {
  return (PATH_LOCALES as readonly string[]).includes(value ?? "");
}

/** `/de/schools` → `{ locale: "de", path: "/schools" }`; null for an address
 * that is not a language version of a listed page. */
export function splitLanguagePath(pathname: string): { locale: PathLocale; path: string } | null {
  const [, first, ...rest] = pathname.split("/");
  if (!isPathLocale(first)) return null;
  const path = `/${rest.join("/")}`.replace(/\/+$/, "") || "/";
  return LANGUAGE_PAGES[path]?.includes(first) ? { locale: first, path } : null;
}

/** The address of `path` in `locale`: prefixed where that language version
 * exists, the root address otherwise. `#fragment` and `?query` are kept. */
export function languageHref(locale: string | null | undefined, href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const tail = cut < 0 ? "" : href.slice(cut);
  if (!isPathLocale(locale ?? undefined) || !LANGUAGE_PAGES[path]?.includes(locale as PathLocale)) return href;
  return `/${locale}${path === "/" ? "" : path}${tail}`;
}

/** hreflang → path for one page: de-CH and de on the German address, fr-CH
 * and fr, it-CH and it, en and x-default on the root. Every version of the
 * page names every other, so the set is reciprocal by construction. */
export function languageAlternates(path: string, locales: readonly string[] = LANGUAGE_PAGES[path] ?? []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of PATH_LOCALES) {
    if (!locales.includes(locale)) continue;
    const href = languageHref(locale, path);
    out[`${locale}-CH`] = href;
    out[locale] = href;
  }
  out.en = path;
  out["x-default"] = path;
  return out;
}

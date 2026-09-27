import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LANGUAGE_PAGES, languageAlternates, languageHref } from "./languagePaths";
import { PATH_LOCALE_HEADER } from "./requestKeys";

/**
 * The language address this request came in on (`de` for `/de/schools`), or
 * null at the root — B2473. Set by the proxy only.
 */
export async function requestPathLocale(): Promise<string | null> {
  return (await headers()).get(PATH_LOCALE_HEADER);
}

/**
 * `alternates` for a page with language addresses: its own address as the
 * canonical — `/de/schools` at the German one, `/schools` at the root
 * whatever language a cookie rendered it in — and every language version as
 * hreflang. `locales` narrows the listed set where the page knows better
 * (the imprint lists the languages it was written in). A language address
 * the page does not have is a 404.
 */
export async function pageAlternates(
  path: string,
  locales: readonly string[] = LANGUAGE_PAGES[path] ?? [],
): Promise<{ canonical: string; languages: Record<string, string> }> {
  const pathLocale = await requestPathLocale();
  if (pathLocale && !locales.includes(pathLocale)) notFound();
  return { canonical: languageHref(pathLocale, path), languages: languageAlternates(path, locales) };
}

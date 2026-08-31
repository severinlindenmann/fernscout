import { userExists } from "./users";
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { loadServerConfig, loadUserConfig } from "./config";
import { MAINTAINED_LOCALES, translate, type TranslationKey } from "./i18n";

/**
 * The two language layers (ROADMAP §1.2, decision 13).
 *
 * **UI chrome** is translated by us in a maintained set — `content/locales/<code>.json`
 * — and anything missing falls back to English. **Content** is written in
 * whatever language the author writes in, and needs no dictionary at all.
 *
 * That split is what makes multi-language survivable: a Croatian self-hoster
 * writes Croatian entries under English menus and it looks deliberate rather
 * than broken. Nobody has to translate a nav bar to publish a post.
 *
 * Dictionaries are read here, on the server, and handed to `LocaleProvider` as
 * props. They are deliberately *not* imported statically: a static import would
 * mean adding a language required a code change, and would ship every language
 * to every reader.
 */

export const FALLBACK_LOCALE = "en";

export type Dictionary = Record<string, string>;

/**
 * Where a dictionary is looked for, most specific first.
 *
 * The strings ship *with the software* — they are its UI, not somebody's
 * travel writing — but an instance may override them by dropping its own
 * `locales/` into its content folder. When `CONTENT_DIR` points somewhere with
 * none (a test fixture, a fresh instance), the shipped set still applies:
 * a site with no words is not a useful fallback.
 */
function localeFiles(code: string): string[] {
  const shipped = path.join(process.cwd(), "content", "locales", `${code}.json`);
  const own = path.join(contentRoot(), "locales", `${code}.json`);
  return own === shipped ? [shipped] : [shipped, own];
}

const cache = new Map<string, Dictionary>();

/**
 * The locales this project maintains chrome for.
 *
 * A journal may offer others — their content translations work and the chrome
 * falls back to English (ROADMAP §1.2) — but only these are offered as an
 * interface language.
 */
export function installedLocales(): string[] {
  return [...MAINTAINED_LOCALES];
}

/**
 * The locales one journal offers, in the order it lists them.
 *
 * A language the user asked for but which has no dictionary is still offered:
 * its *content* translations work, and the chrome falls back to English. That
 * is the whole point of the split — refusing it would be refusing the feature.
 */
export function localesFor(username: string): string[] {
  try {
    const configured = loadUserConfig(username).locales;
    return configured.length > 0 ? configured : [FALLBACK_LOCALE];
  } catch {
    return [FALLBACK_LOCALE];
  }
}

export function defaultLocaleFor(username: string): string {
  try {
    return loadUserConfig(username).defaultLocale;
  } catch {
    return FALLBACK_LOCALE;
  }
}

function readDictionary(code: string): Dictionary {
  const key = `${contentRoot()}::${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Shipped strings first, then the instance's own on top, so an override file
  // may replace a handful of strings without restating all 284.
  const parsed: Dictionary = {};
  for (const file of localeFiles(code)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v === "string") parsed[k] = v;
        }
      }
    } catch {
      // A missing dictionary is not fatal: English chrome is a usable site,
      // and a locale with only content translations is a supported case.
    }
  }
  cache.set(key, parsed);
  return parsed;
}

/**
 * The dictionary a page renders with: the locale's own strings over English.
 *
 * Merged rather than chained so the client receives one flat object and never
 * has to know a fallback exists.
 */
export function dictionaryFor(code: string): Dictionary {
  const english = readDictionary(FALLBACK_LOCALE);
  if (code === FALLBACK_LOCALE) return english;
  return { ...english, ...readDictionary(code) };
}

/** Test seam. */
export function clearLocaleCache(): void {
  cache.clear();
}

/**
 * Translate on the server, where the locale is known but the dictionary is not
 * yet loaded.
 *
 * Client components take their dictionary from `LocaleProvider` instead — this
 * one reaches the filesystem, which the browser bundle cannot.
 */
export function translateIn(
  locale: string,
  key: TranslationKey,
  vars?: Record<string, string>,
): string {
  return translate(dictionaryFor(locale), key, vars);
}

/** Every dictionary a journal offers, for a form that switches language
 * without a round trip. */
export function dictionariesFor(username: string): Record<string, Dictionary> {
  const out: Record<string, Dictionary> = {};
  for (const code of localesFor(username)) out[code] = dictionaryFor(code);
  return out;
}

/**
 * The language for pages that belong to no journal — the landing page, the
 * notices, a 404 for an address that names nobody.
 *
 * The default user's language if there is one, since on a single-journal
 * instance that is the language of everyone who will ever see these pages.
 */
/**
 * The language a page at this path should render in before any cookie.
 *
 * `<html lang>` is written by the root layout, which sits above `[user]` and
 * therefore cannot see whose journal is being read. Without this, a German
 * journal on an English instance served `lang="en"` and English chrome, and
 * only corrected itself once the inner provider hydrated — visible, and wrong
 * for anyone who reads with JavaScript off or a screen reader that has already
 * announced the language.
 *
 * An unknown or reserved first segment is not a journal, so the instance's own
 * language is the right answer for the landing page and for a 404.
 */
export function localeForPath(pathname: string | null | undefined): string {
  const first = (pathname ?? "").split("/").filter(Boolean)[0];
  if (!first) return instanceLocale();
  return userExists(first) ? defaultLocaleFor(first) : instanceLocale();
}

export function instanceLocale(): string {
  try {
    const owner = loadServerConfig().site.defaultUser;
    return owner ? defaultLocaleFor(owner) : FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/**
 * The language to render a *server-side* string in, for this request.
 *
 * The reader's own choice first, then the journal's, then the instance's — the
 * same order the root layout has always used for `<html lang>`, lifted out of
 * it because `generateMetadata` needs the identical answer and was not getting
 * one. Every page title was a hardcoded English literal in a `metadata`
 * object, so a German reader on a German journal got "Gallery" in the browser
 * tab, in their history and in anything they bookmarked or shared, while the
 * page itself said "Galerie".
 *
 * Server-only: it reads the request's cookies and headers.
 */
export async function requestLocale(): Promise<string> {
  const { cookies, headers } = await import("next/headers");
  const { LOCALE_COOKIE, PATH_HEADER } = await import("@/proxy");
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (chosen && installedLocales().includes(chosen)) return chosen;
  return localeForPath((await headers()).get(PATH_HEADER));
}

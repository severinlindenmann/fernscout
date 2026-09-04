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

/** Cached against what the files on disk currently are — see `dictionarySignature`. */
const cache = new Map<string, { signature: string; dictionary: Dictionary }>();

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

/**
 * A cheap fingerprint of the files a dictionary is built from — the same shape
 * as `entriesSignature` in lib/entries.ts, for the same reason.
 *
 * Without it this cache was populated and never invalidated, so a string added
 * to `en.json` rendered as `map.titlePlanned` — the key itself, in an `<h1>` —
 * until somebody restarted the process (B59). That reads as a broken build
 * rather than a stale cache, which is what made it expensive: the natural next
 * move is to go back and check the JSON, and the JSON is correct.
 *
 * A file that does not exist is part of the signature too, as `-`. That is not
 * a detail: `$CONTENT_DIR/locales/` arriving for the first time — a deploy
 * syncing the shipped dictionaries (B56), or an author dropping in their own
 * override — has to count as a change, and it is a change from "absent".
 *
 * Two or three `stat` calls per render, against a `readFileSync` and a
 * `JSON.parse` of two files it saves.
 */
function dictionarySignature(files: string[]): string {
  return files
    .map((file) => {
      try {
        const { mtimeMs, size } = fs.statSync(file);
        return `${file}:${mtimeMs}:${size}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
}

function readDictionary(code: string): Dictionary {
  const files = localeFiles(code);
  const key = `${contentRoot()}::${code}`;
  const signature = dictionarySignature(files);
  const hit = cache.get(key);
  if (hit && hit.signature === signature) return hit.dictionary;

  // Shipped strings first, then the instance's own on top, so an override file
  // may replace a handful of strings without restating all 284.
  const parsed: Dictionary = {};
  for (const file of files) {
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
  cache.set(key, { signature, dictionary: parsed });
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

/**
 * Test seam — drops every memoised dictionary.
 *
 * Still here after B59 gave the cache a staleness check, because a test that
 * points `CONTENT_DIR` at a fresh directory wants a clean slate rather than a
 * correct one, and because the signature is deliberately coarse: two writes to
 * the same file inside one millisecond, ending at the same length, look
 * identical to it.
 */
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
 * The one rule for "which language does this reader get", stated once.
 *
 * A reader's own choice, honoured only if the set in front of them offers it,
 * and otherwise the fallback that set comes with. Both callers below go
 * through it — the page body in `app/[user]/layout.tsx` and the `<title>` in
 * every `generateMetadata` — because when they each had their own copy of the
 * expression the two copies disagreed (B140, B185): the body narrowed the
 * cookie to `user.locales` and the metadata narrowed it to `installedLocales()`,
 * so a `fs.locale=de` cookie carried from one journal produced a German tab
 * title over an entirely English page on the next.
 */
export function readerLocale(
  chosen: string | null | undefined,
  offered: string[],
  fallback: string,
): string {
  return chosen && offered.includes(chosen) ? chosen : fallback;
}

/**
 * The same rule, for a request that knows only its path.
 *
 * Inside a journal the set on offer is that journal's own `locales`, which is
 * exactly what the layout asks — so the tab title is written in the language
 * the page underneath it is about to render in, and never in one the journal
 * does not speak.
 *
 * Outside a journal — the landing page, `/welcome`, the notices, a 404 for an
 * address that names nobody — there is no `user.locales` to narrow against, so
 * the instance's maintained set stands in and the reader's choice still counts.
 */
export function readerLocaleForPath(
  pathname: string | null | undefined,
  chosen: string | null | undefined,
): string {
  const first = (pathname ?? "").split("/").filter(Boolean)[0];
  if (first && userExists(first)) {
    return readerLocale(chosen, localesFor(first), defaultLocaleFor(first));
  }
  return readerLocale(chosen, installedLocales(), instanceLocale());
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
 * "The journal's" is load-bearing in the first clause too, and was not always:
 * the choice used to be honoured whenever the *project* maintained chrome for
 * it, whatever the journal offered. See `readerLocaleForPath`.
 *
 * Server-only: it reads the request's cookies and headers.
 */
export async function requestLocale(): Promise<string> {
  const { cookies, headers } = await import("next/headers");
  const { LOCALE_COOKIE, PATH_HEADER } = await import("./requestKeys");
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  return readerLocaleForPath((await headers()).get(PATH_HEADER), chosen);
}

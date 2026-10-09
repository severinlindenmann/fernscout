import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { loadServerConfig } from "@/lib/config";
import { contentRoot } from "@/lib/contentRoot";
import { LANGUAGE_PAGES, MARKDOWN_PAGES, isPathLocale, splitLanguagePath, splitMarkdownPath } from "@/lib/languagePaths";
import { LOCALE_COOKIE, PATH_HEADER, PATH_LOCALE_HEADER, SEARCH_HEADER } from "@/lib/requestKeys";
import { formatRequestLine } from "@/lib/requestLog";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/requestId";
import { journalTombstone, tripTombstone, type Tombstone } from "@/lib/tombstones";
import { JOURNAL_ROUTE_ROOT, USERNAME_RE, journalPath, parseJournalPath } from "@/lib/journalPath";

/**
 * `?lang=de` — a shareable link in a particular language.
 *
 * This is Next's `proxy` convention, which replaced `middleware` in 16.
 *
 * The alternative was `/de/alex/day/x`: a locale segment on every route.
 * That is the stronger pattern for search engines, and it is also a second
 * full route restructure that invalidates every URL this project builds — the
 * documentation file, the feeds, the sitemap, OG metadata, the REST paths.
 * For a journal read by a few dozen people who arrive from a link
 * somebody sent them, the parameter buys most of the value for a fraction of
 * the cost.
 *
 * The parameter is turned into a cookie **here**, rather than in the page,
 * for two reasons. A layout cannot set a cookie in Next — only middleware,
 * route handlers and server actions can. And doing it in the browser would put
 * the choice somewhere the server cannot see it, which is the bug this whole
 * change exists to fix: the language used to live in localStorage, so the
 * server rendered English no matter what the reader had picked.
 *
 * Setting it on the *request* as well as the response is what makes the very
 * first click work: without that, the page rendering this request would still
 * read the old cookie and the reader would need a second click.
 *
 * It also carries the path forward as a header. The root layout writes
 * `<html lang>` and it sits above `[user]`, so it cannot otherwise tell whose
 * journal is being read: a German journal on an English instance rendered
 * `lang="en"` and English chrome, and only corrected once the inner provider
 * hydrated. `headers()` is readable in a layout; the pathname is not.
 */

/**
 * `LOCALE_COOKIE` and `PATH_HEADER` are in `lib/requestKeys.ts`, not here.
 *
 * They used to be here, beside the code that sets them, and that quietly put
 * this whole module into the browser bundle: a client component imported one
 * of the constants from `@/proxy`. It cost nothing until the proxy needed to
 * read a file, and then it cost the production build. Nothing exported from
 * this file should be something a page or a component imports.
 */

/**
 * A language tag, not a prefix of one.
 *
 * Validating the whole value before shortening it is the difference between
 * `de-CH` meaning German and `englishplease` also meaning English, which is
 * what taking the first two characters first would have given.
 */
const LANGUAGE_TAG = /^[a-z]{2}(-[a-z0-9]{2,8})?$/;

/**
 * `410 Gone`, for a journal or a trip that was deleted.
 *
 * This has to happen here and it cannot happen anywhere else: a page in Next
 * cannot set a status code — `notFound()` gives 404 and nothing gives 410 —
 * and a route handler cannot sit at a path a page already occupies. The proxy
 * runs before either, on the Node.js runtime (the default since 16), so a
 * filesystem read is available to it.
 *
 * 410 rather than 404 because the two are different instructions. A crawler
 * drops a 410 and keeps retrying a 404 for a year; a person reading "this was
 * removed" knows they did not mistype the address somebody gave them. The
 * sentence comes off the tombstone already translated — see lib/tombstones.ts
 * for why it is stored rather than rendered here.
 */
function gonePage(stone: Tombstone): NextResponse {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body =
    `<!doctype html><html lang="${escape(stone.notice.lang)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${escape(stone.notice.title)}</title></head>` +
    `<body style="margin:0;background:#fffaf0;color:#1e293b;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">` +
    `<main style="max-width:36rem;margin:0 auto;padding:5rem 1.5rem">` +
    `<h1 style="font-size:2rem;line-height:1.2;margin:0 0 1.25rem">${escape(stone.notice.title)}</h1>` +
    `<p style="font-size:1.25rem;line-height:1.7;color:#3a4a63;margin:0 0 2rem">${escape(stone.notice.body)}</p>` +
    `<p><a href="${escape(stone.notice.homeHref)}" style="display:inline-block;min-height:3rem;` +
    `padding:0.75rem 1.5rem;border-radius:9999px;background:#ffd23f;color:#4a3300;` +
    `font-size:1.125rem;font-weight:600;text-decoration:none">${escape(stone.notice.homeLabel)}</a></p>` +
    `</main></body></html>`;

  return new NextResponse(body, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** The tombstone covering this journal path, if there is one. Only the two
 * shapes a link in somebody's address book actually has: the journal, and a
 * trip. */
function goneFor(username: string, rest: string): NextResponse | null {
  if (!USERNAME_RE.test(username)) return null;
  const journal = journalTombstone(username);
  if (journal) return gonePage(journal);

  // `/@<user>/trips/<trip-id>` — the only URL a deleted trip had of its own.
  const segments = rest.split("/").filter(Boolean);
  if (segments[0] === "trips" && segments[1]) {
    const trip = tripTombstone(username, segments[1]);
    // B2672: belt and braces. `createTrip`/`renameTrip` already clear the
    // tombstone the moment the id is live again, but a tombstone that
    // somehow outlives that (a hand-restored backup, a race) must not keep
    // answering 410 for a folder that is sitting right there — one more
    // `existsSync`, the same cost `tripTombstone` above already paid.
    if (trip && !fs.existsSync(path.join(contentRoot(), username, "trips", segments[1]))) {
      return gonePage(trip);
    }
  }
  return null;
}

/**
 * Where a journal path is served from, or null when the path cannot be one.
 *
 * `/@anna/…` is rendered by `app/at/[user]/…` — see `lib/journalPath.ts` for
 * why the two differ — except for the day markdown twins (B291), which are
 * route handlers under `/api/md/`. A bare `:slug.md` param would stop at the
 * first `.`, and a slug is not guaranteed not to contain one, so the slug is
 * everything up to the final `.md`.
 *
 * The name must be a real username, and no segment may be a dot segment in
 * disguise (`%2e%2e`) or hide a slash: the target is assigned to a URL, which
 * resolves those, so `/@../admin` would otherwise be served from `/admin` —
 * past the header pins `next.config.ts` matched against the `@` path.
 */
function journalTarget(username: string, rest: string): { path: string; twin: boolean } | null {
  if (!USERNAME_RE.test(username)) return null;
  const unsafe = rest.split("/").some((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    return decoded === "." || decoded === ".." || /[/\\]/.test(decoded);
  });
  if (unsafe) return null;

  const trip = /^\/trips\/([^/]+)\/day\/([^/]+)\.md$/i.exec(rest);
  if (trip) return { path: `/api/md/${username}/${trip[1]}/${trip[2]}`, twin: true };
  const day = /^\/day\/([^/]+)\.md$/i.exec(rest);
  if (day) return { path: `/api/md/${username}/${day[1]}`, twin: true };
  return { path: `/${JOURNAL_ROUTE_ROOT}/${username}${rest}`, twin: false };
}

/**
 * The internal journal route, asked for by name: `/at/anna/…`, or `/%61t/…`
 * spelled so as to slip past a string comparison. Nothing links there, but
 * the address is guessable, and answering it would give every page two URLs
 * — the second without the header pins. A permanent redirect to the `@` form
 * keeps it at one.
 */
function internalJournalPath(pathname: string): string | null {
  const [, first, username, ...rest] = pathname.split("/");
  let decoded: string;
  try {
    decoded = decodeURIComponent(first ?? "");
  } catch {
    return null;
  }
  if (decoded !== JOURNAL_ROUTE_ROOT || !username) return null;
  return journalPath(username, rest.length ? `/${rest.join("/")}` : "");
}

/**
 * `features.logging.enabled` — read directly rather than through
 * `lib/capabilities.ts`'s `isEnabled()`. That module imports `lib/users.ts`,
 * which is `server-only`, and this file is imported here for the same reason
 * `lib/tombstones.ts` gives for itself: nothing proxy.ts pulls in should
 * assume it is never bundled for the edge or the browser. `logging` needs no
 * env var and no database, so this one config read *is* the whole of what
 * `isEnabled("logging")` would have computed anyway — see B257.
 *
 * Cheap and short-circuiting on purpose: `loadServerConfig()` is memoised
 * against the file's own mtime, so this is one map lookup per request when
 * the capability is off, and no formatting happens unless it is on.
 */
function loggingEnabled(): boolean {
  try {
    return loadServerConfig().features.logging.enabled === true;
  } catch {
    return false;
  }
}

/** `features.auth.enabled`, read directly for the reason `loggingEnabled`
 * gives. */
function authEnabled(): boolean {
  try {
    return loadServerConfig().features.auth.enabled === true;
  } catch {
    return false;
  }
}

/** The two session cookie names, as `lib/auth` spells them (it is
 * server-only); `test/studio-signin.test.ts` keeps them equal. */
const IDENTITY_COOKIE_NAME = "fs_identity";
const GUEST_COOKIE_NAME = "fs_session";

/**
 * One line to stdout, method + path + user agent, when the capability above
 * is on. See `lib/requestLog.ts` for the format and for why status,
 * duration and response size are not in it.
 *
 * Called for every request the matcher below lets through, static build
 * assets excluded — see the matcher's own comment for that choice.
 */
function logRequest(request: NextRequest): void {
  if (request.nextUrl.pathname === "/api/health") return; // monitoring pings, ~26% of all lines
  if (!loggingEnabled()) return;
  console.log(
    formatRequestLine(
      request.method,
      request.nextUrl.pathname,
      request.headers.get("user-agent"),
      request.headers.get(REQUEST_ID_HEADER) ?? "-",
    ),
  );
}

/** Whether a client asked for Markdown ahead of HTML (an agent's fetch, not
 * a browser, which lists text/html first). */
function prefersMarkdown(request: NextRequest): boolean {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  const md = accept.indexOf("text/markdown");
  if (md < 0) return false;
  const html = accept.indexOf("text/html");
  return html < 0 || md < html;
}

/** The page at `pathname`, when it has a Markdown version. */
function markdownPage(pathname: string): { locale: string | null; path: string } | null {
  const language = splitLanguagePath(pathname);
  if (language) return MARKDOWN_PAGES.includes(language.path) ? language : null;
  return MARKDOWN_PAGES.includes(pathname) ? { locale: null, path: pathname } : null;
}

/** B-2951: every response carries a fresh request id. A client-sent one is
 * overwritten, never trusted; it is also forwarded on the request headers so
 * the root layout can show it on an error screen. */
export default function proxy(request: NextRequest): NextResponse {
  const id = newRequestId();
  request.headers.set(REQUEST_ID_HEADER, id);
  const response = route(request);
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
}

function route(request: NextRequest): NextResponse {
  logRequest(request);

  const pathname = request.nextUrl.pathname;

  // The API is the write side of this software (B257's whole motivation) and
  // never ran through the checks below — the matcher used to exclude it
  // outright. Widening the matcher so it can be logged must not also start
  // running tombstone/locale logic against it for the first time: `api` is a
  // reserved name that can never actually be deleted, so a per-request fs
  // stat against `content/.deleted/api.json` would be pure waste, forever,
  // on the hot path this ticket was explicitly told not to slow down.
  if (pathname.startsWith("/api/")) return NextResponse.next({ request });

  const internal = internalJournalPath(pathname);
  if (internal) return redirectTo(request, internal);

  // Only this proxy says which language an address asked for — B2473.
  request.headers.delete(PATH_LOCALE_HEADER);

  // B2488 — the Markdown version of a page, at `/schools.md` or asked for
  // with `Accept: text/markdown` on the page's own address.
  const markdown = splitMarkdownPath(pathname) ?? (prefersMarkdown(request) ? markdownPage(pathname) : null);
  if (markdown) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/page-md";
    url.search = "";
    url.searchParams.set("path", markdown.path);
    if (markdown.locale) url.searchParams.set("lang", markdown.locale);
    // A route handler behind a rewrite sees the address it was asked on,
    // not the rewritten query — so the page travels as headers too.
    request.headers.set(PATH_HEADER, markdown.path);
    if (markdown.locale) request.headers.set(PATH_LOCALE_HEADER, markdown.locale);
    const response = NextResponse.rewrite(url, { request });
    response.headers.set("Vary", "Accept");
    return response;
  }

  // `/de/schools` is `/schools` in German: rewritten, with the language in a
  // header the locale resolver reads before any cookie. An address under
  // /de/ that is not a listed page matches no route and 404s — journals live
  // under `@`, so no name can be mistaken for a language.
  const language = splitLanguagePath(pathname);
  if (language) {
    request.headers.set(PATH_HEADER, language.path);
    request.headers.set(PATH_LOCALE_HEADER, language.locale);
    const url = request.nextUrl.clone();
    url.pathname = language.path;
    return NextResponse.rewrite(url, { request });
  }

  const journal = parseJournalPath(pathname);
  const target = journal ? journalTarget(journal.username, journal.rest) : null;
  if (journal) {
    // `%40anna` — how some apps write the `@` when they copy a link. One
    // address per page, so it converges on the `@` form.
    if (!pathname.startsWith("/@")) return redirectTo(request, journalPath(journal.username, journal.rest));
    // A twin answers its own 410, in plain text for the agent reading it —
    // `lib/api/markdownTwin.ts`.
    const gone = target && !target.twin ? goneFor(journal.username, journal.rest) : null;
    if (gone) return gone;
  }

  // B-2779. Nobody carrying either session cookie, asking for any studio
  // address: one generic sign-in page, the same for a journal that exists
  // and one that does not. Cookie presence only — the proxy does no database
  // work — so a stale cookie still reaches the page's own gate (a 404).
  if (
    journal &&
    request.method === "GET" &&
    (journal.rest === "/studio" || journal.rest.startsWith("/studio/")) &&
    !request.cookies.has(IDENTITY_COOKIE_NAME) &&
    !request.cookies.has(GUEST_COOKIE_NAME) &&
    authEnabled()
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/studio-signin";
    request.headers.set(PATH_HEADER, "/studio-signin");
    return NextResponse.rewrite(url, { request });
  }

  // The public path, `@` included: this is what the root layout and the
  // pages read to learn whose journal is on show (`lib/locales.ts`).
  request.headers.set(PATH_HEADER, pathname);
  request.headers.set(SEARCH_HEADER, request.nextUrl.search);

  const asked = request.nextUrl.searchParams.get("lang");
  const tag = asked?.trim().toLowerCase();
  const locale = tag && LANGUAGE_TAG.test(tag) ? tag.slice(0, 2) : null;

  // A page with its own address in the asked language: send the link there,
  // once and for good, so `?lang=de` is not a second URL for /de/schools. The
  // cookie still goes with it, as it always did.
  if (locale && isPathLocale(locale) && LANGUAGE_PAGES[pathname]?.includes(locale)) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("lang");
    url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.redirect(url, 301);
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return response;
  }

  // No `Vary` for the HTML of these pages: Next sets the header itself on
  // every app page and overwrites one from here. It also serves them
  // `private, no-store`, so no shared cache ever holds one to mix up by
  // cookie, Accept-Language or Accept. The Markdown says `Vary: Accept`.
  //
  // Whether this journal actually offers the language is decided downstream,
  // where its config is readable; middleware only carries the request.
  if (locale) request.cookies.set(LOCALE_COOKIE, locale);

  // A journal path that cannot be one — a malformed name, a dot segment —
  // is not rewritten, and so matches no route: a 404.
  let response: NextResponse;
  const url = request.nextUrl.clone();
  if (target) url.pathname = target.path;
  if (target && url.pathname === target.path) {
    response = NextResponse.rewrite(url, { request });
  } else {
    response = NextResponse.next({ request });
  }

  if (locale) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return response;
}

/** A permanent redirect to `pathname`, keeping the query string. */
function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: [
    // Everything a reader looks at. Not the API, not build assets, and not the
    // agent-facing documents, which have no chrome to translate.
    //
    // `_next/static`, `_next/image` and `favicon.ico` stay excluded below for
    // request logging too (B257), on purpose: every one of them is a build
    // asset served dozens of times per page view, and a log that is mostly
    // `/_next/static/…` lines is a log nobody reads. Nothing diagnostic is
    // lost — the page request that asked for them is still logged.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:txt|json|xml|md|png|svg|ico)$).*)",
    // Every journal path, whatever its extension: `/@anna/…` is only ever
    // served through the rewrite above, so its feeds, `.md` twins, media and
    // agent documents must all come through here — not just the pages the
    // extension exclusion above lets by. `%40` is the encoded `@`, and `/at/…`
    // is the internal route, redirected.
    "/(@.*)",
    "/(%40.*)",
    "/at/:path*",
    // A journal's machine documents at their pre-`@` address — a feed reader
    // subscribed before the move, an agent's saved link. Nothing is rewritten
    // for them; they only need `PATH_HEADER`, so the root 404 can send them on
    // to the `@` form (`app/not-found.tsx`). The extension exclusion above
    // would otherwise keep the proxy from ever seeing them.
    "/:user/documentation.txt",
    "/:user/feed.xml",
    "/:user/search-index.json",
    "/:user/story.json",
    "/:user/day/:slug([^/]+)\\.md",
    "/:user/trips/:trip/day/:slug([^/]+)\\.md",
    // Added for request logging (B257), not for the 410 or the language
    // cookie. `/agent.md` (now a redirect — B311) and the instance's own
    // `/documentation.txt` are agent-facing documents the extension exclusion
    // above was written to skip translating — and an agent's failed fetch to
    // one of them is exactly what this ticket exists to let an operator
    // confirm or rule out. `/skill/:name.md` are the nine task guides
    // `/agent.md` used to be, one route each (B311). `/api/:path*` is the
    // write side: every draft, publish and invite call, previously invisible
    // to proxy entirely. `proxy()` above skips the tombstone and locale
    // checks for it — see the comment there.
    "/documentation.txt",
    "/agent.md",
    "/skill/:name.md",
    "/api/:path*",
    // The pages' Markdown versions (B2488) — `.md` is excluded above.
    "/((?:de/|fr/|it/)?(?:index|prices|schools|schools/demo|tour-operators|tour-operators/demo|switch|guides/[a-z-]+)\\.md)",
  ],
};

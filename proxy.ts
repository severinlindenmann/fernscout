import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, PATH_HEADER } from "@/lib/requestKeys";
import { journalTombstone, tripTombstone, type Tombstone } from "@/lib/tombstones";

/**
 * `?lang=de` — a shareable link in a particular language.
 *
 * This is Next's `proxy` convention, which replaced `middleware` in 16.
 *
 * The alternative was `/de/alex/day/x`: a locale segment on every route.
 * That is the stronger pattern for search engines, and it is also a second
 * full route restructure that invalidates every URL this project builds — the
 * documentation file, the feeds, the sitemap, OG metadata, the REST and MCP
 * paths. For a journal read by a few dozen people who arrive from a link
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

/** The tombstone covering this path, if there is one. Only the two shapes a
 * link in somebody's address book actually has: the journal, and a trip. */
function goneFor(pathname: string): NextResponse | null {
  const segments = pathname.split("/").filter(Boolean);
  const username = segments[0];
  if (!username) return null;

  const journal = journalTombstone(username);
  if (journal) return gonePage(journal);

  // `/<user>/trips/<trip-id>` — the only URL a deleted trip had of its own.
  if (segments[1] === "trips" && segments[2]) {
    const trip = tripTombstone(username, segments[2]);
    if (trip) return gonePage(trip);
  }
  return null;
}

export default function proxy(request: NextRequest) {
  const gone = goneFor(request.nextUrl.pathname);
  if (gone) return gone;

  request.headers.set(PATH_HEADER, request.nextUrl.pathname);

  const asked = request.nextUrl.searchParams.get("lang");
  const tag = asked?.trim().toLowerCase();
  const locale = tag && LANGUAGE_TAG.test(tag) ? tag.slice(0, 2) : null;

  if (!locale) return NextResponse.next({ request });

  // Whether this journal actually offers the language is decided downstream,
  // where its config is readable; middleware only carries the request.
  request.cookies.set(LOCALE_COOKIE, locale);

  const response = NextResponse.next({ request });
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: [
    // Everything a reader looks at. Not the API, not build assets, and not the
    // agent-facing documents, which have no chrome to translate.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:txt|json|xml|md|png|svg|ico)$).*)",
    // Added for the 410 above, not for the language cookie. These four are the
    // agent- and reader-facing documents of a journal, and after it is deleted
    // they must say it was removed rather than that it was never here. The
    // pattern above excludes them by extension.
    "/:user/documentation.txt",
    "/:user/feed.xml",
    "/:user/search-index.json",
    "/:user/story.json",
  ],
};

import { NextResponse, type NextRequest } from "next/server";

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

export const LOCALE_COOKIE = "fs.locale";

/** The request path, for the root layout. See above. */
export const PATH_HEADER = "x-fernscout-path";

/**
 * A language tag, not a prefix of one.
 *
 * Validating the whole value before shortening it is the difference between
 * `de-CH` meaning German and `englishplease` also meaning English, which is
 * what taking the first two characters first would have given.
 */
const LANGUAGE_TAG = /^[a-z]{2}(-[a-z0-9]{2,8})?$/;

export default function proxy(request: NextRequest) {
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
  // Everything a reader looks at. Not the API, not build assets, and not the
  // agent-facing documents, which have no chrome to translate.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:txt|json|xml|md|png|svg|ico)$).*)"],
};

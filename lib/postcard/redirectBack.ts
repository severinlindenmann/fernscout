/**
 * Back to the preview page, as a **relative** location — B460.
 *
 * Both postcard forms were unusable on the live site and the console blamed
 * the Content Security Policy, which was innocent. `next.config.ts` sets
 * `form-action 'self'`, the forms post to the same origin, and that is
 * allowed — but `form-action` is checked against *every hop* of a submission,
 * and these routes answered with a `Location` on another origin entirely:
 *
 * ```
 * $ curl -si -X POST https://fernscout.ch/example/postcards/<id>/send
 * HTTP/2 303
 * location: https://localhost:3000/example/postcards/<id>?result=forbidden
 * ```
 *
 * `Response.redirect()` demands an absolute URL, so both were built with
 * `new URL(path, request.url)` — and behind Caddy `request.url` is the app's
 * own `127.0.0.1:3000`, not the origin the reader is on. The browser blocked
 * it, correctly, and the send button had therefore never worked once.
 *
 * A relative `Location` cannot have that bug: the browser resolves it against
 * whatever origin it is actually on, so it is right on localhost, right on
 * fernscout.ch, and right on a self-hoster's domain whose `site.url` is stale.
 * `serverSite().url` would also work, and is what
 * `app/[user]/u/[token]/route.ts` correctly uses — but that URL goes into an
 * email, where there is no current page to be relative to. This one is
 * followed in place.
 *
 * One function rather than a copy in each route: the two are a security-
 * relevant pair and a copy is how one of them gets fixed.
 */
/**
 * The same answer for a `fetch` — B773.
 *
 * The preview page saves itself as you type, and a 303 to an HTML page is not
 * an answer a `fetch` can read: it follows it, gets a document, and has to
 * guess whether that means saved. So a caller that asks for JSON is told the
 * result *word* — the identical one the redirect puts in `?result=` — and
 * nothing else changes. Same route, same rules, same refusals; a second way to
 * ask rather than a second set of decisions.
 */
export function answerJson(result: string, status = 200): Response {
  return Response.json({ result }, { status });
}

/** Whether this caller wants that instead of a redirect. */
export function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export function backToPreview(user: string, id: string, result: string): Response {
  // `#send` so the browser lands on the box the reader pressed a button in —
  // B850. The button is at the bottom of a long page and the redirect renders
  // a fresh document, so without a fragment the reader arrived at the *top*,
  // where the heading describes the order rather than what just happened to
  // it. Somebody with two orders open read the other one's heading — "ready to
  // send, nothing has been printed or charged" — straight after sending, and
  // reasonably concluded the button had done nothing.
  //
  // The same anchor the `?confirm=1` link and the confirm panel's "back" link
  // use, because all three are navigations in one flow and a fix that covered
  // only this one left the *first* press still jumping to the top.
  const location =
    `/${encodeURIComponent(user)}/postcards/${encodeURIComponent(id)}` +
    `?result=${encodeURIComponent(result)}#send`;
  // 303 so the browser follows with a GET: reloading the preview must not
  // repost the form — which for the send route would be a second attempt to
  // print and charge.
  return new Response(null, { status: 303, headers: { Location: location } });
}

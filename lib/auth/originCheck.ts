import "server-only";
import { serverSite } from "@/lib/site";

/**
 * A second layer behind `sameSite: "lax"` on the doors that spend credits at
 * a printer or delete a trip from the owner's cookie alone — B1559. Those
 * routes (postcard send, photobook order, trip delete) have no CSRF token and
 * rely entirely on the cookie attribute; a same-site subdomain hosting user
 * content, or one cookie set without the attribute, would silently remove the
 * only barrier in front of a one-click spend.
 *
 * Compared by **host only**, not the full origin — a proxy terminating TLS in
 * front of the app can see `http` where the browser sent `https`, and that
 * mismatch says nothing about which site the request came from.
 *
 * Two hosts count as this instance: the one `site.url` (or
 * `NEXT_PUBLIC_SITE_URL`) names, and the one the request itself arrived on
 * (the `Host` header, which is what a reverse proxy forwards) — the second is
 * the fallback that keeps this working in dev, where `site.url` is whatever
 * `site/config.json` says and the request is actually `localhost:<port>`.
 *
 * A **missing** `Origin` is allowed through: older browsers and same-origin,
 * GET-initiated navigations carry none, and `sameSite: "lax"` already covers
 * those. Only a *present and mismatched* `Origin` is refused.
 */
export function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // An Origin header that is not a URL at all is not one we recognise as
    // this site.
    return true;
  }

  const configuredHost = (() => {
    try {
      return new URL(serverSite().url).host;
    } catch {
      return null;
    }
  })();
  if (configuredHost && originHost === configuredHost) return false;

  const requestHost = request.headers.get("host");
  if (requestHost && originHost === requestHost) return false;

  return true;
}

/** The stable refusal body for all three doors — B1559. */
export const FOREIGN_ORIGIN_REFUSAL = {
  error: "foreign_origin",
  message:
    "This request's Origin does not match this site. If you are a browser " +
    "extension, a proxy, or testing tool, retry from the site itself.",
};

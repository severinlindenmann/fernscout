import "server-only";
import { MAPS_HOSTS as ALLOWED_HOSTS, readMapsUrl } from "@/lib/plan/readPasted";

/**
 * A Maps link pasted into an ordinary text message — B1859.
 *
 * People share `maps.app.goo.gl/…` far more often than they drop a native
 * pin. This is the one place in `lib/whatsapp/` an inbound message causes an
 * *outbound* network request — that shape is exactly a server-side request
 * forgery unless it is bounded hard: only the known Google/Apple Maps link
 * hosts are ever fetched, at every hop of a redirect chain (not just the
 * first), with a small redirect cap and a per-fetch timeout, and no failure
 * of any kind ever throws into the message handler — it resolves to
 * `{ ok: false }` instead, the same as a link nobody could make sense of.
 */

/** Well under Meta's own 24h webhook processing patience, and well past how
 *  long a real redirect hop ever takes. */
const FETCH_TIMEOUT_MS = 4000;

/** A short-link chain is one or two hops in practice; this is a hard
 *  ceiling against a redirect loop or a host that never lands. */
const MAX_REDIRECTS = 5;

/**
 * The first URL in a message whose host is one this server will ever follow
 * — a link pasted alongside a sentence ("here it is: https://maps.app.goo.gl/xyz")
 * is the ordinary shape, so this scans the message rather than requiring the
 * whole body to be nothing but the link. Returns `null` for a message with
 * no URL at all, or where every URL present names a host outside the list —
 * both read the same as "no Maps link here" to the caller.
 */
export function findMapsLink(text: string): URL | null {
  const candidates = text.match(/https?:\/\/\S+/g);
  if (!candidates) return null;
  for (const raw of candidates) {
    let url: URL;
    try {
      // A link inside a sentence often trails punctuation ("...goo.gl/xyz.")
      // that is not part of the URL itself.
      url = new URL(raw.replace(/[).,!?]+$/, ""));
    } catch {
      continue;
    }
    if (ALLOWED_HOSTS.has(url.hostname)) return url;
  }
  return null;
}

/** Coordinates read off a Maps URL's own shape — never off the page body —
 *  by the same pure reader the Planner's paste box uses. */
function coordsFromUrl(url: URL): { lat: number; lon: number } | null {
  const place = readMapsUrl(url);
  return place ? { lat: place.lat, lon: place.lng } : null;
}

export type MapsLinkResolution = { ok: true; lat: number; lon: number; resolvedUrl: string } | { ok: false };

/**
 * Follow a Maps short-link server-side and read the coordinates off the URL
 * it finally lands on. Say what was resolved before using it is the caller's
 * job (`paid/whatsapp/lib/whatsapp/dispatch.ts`), the same discipline the voice transcript
 * echo already follows — this function only ever answers with coordinates
 * or `{ ok: false }`, never throws, and never fetches a host outside
 * `ALLOWED_HOSTS` even mid-redirect.
 */
export async function resolveMapsLink(start: URL): Promise<MapsLinkResolution> {
  let current = start;
  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(current.href, { redirect: "manual", signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false };
        }
        if (!ALLOWED_HOSTS.has(next.hostname)) return { ok: false };
        // Google's own short-link redirect carries the coordinates in the
        // `Location` header itself — the common case needs no second
        // request at all. Only fall through to fetching `next` when this
        // hop's own URL does not already say where it points.
        const immediate = coordsFromUrl(next);
        if (immediate) return { ok: true, ...immediate, resolvedUrl: next.href };
        current = next;
        continue;
      }

      const coords = coordsFromUrl(current);
      return coords ? { ok: true, ...coords, resolvedUrl: current.href } : { ok: false };
    }
    return { ok: false };
  } catch {
    // Network failure, timeout (the abort surfaces here), a malformed
    // redirect target — every failure shape lands on the same honest
    // answer: nothing was derived.
    return { ok: false };
  }
}

import { reversePlace } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { requestLocale } from "@/lib/locales";
import { parsePastedText } from "@/lib/plan/readPasted";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { findMapsLink, resolveMapsLink } from "@/lib/mapsLink";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * "What is this thing I just pasted?" — B2010.
 *
 * The Planner's one box takes a Maps link, a coordinate pair, a plain URL, a
 * cost line or a place name, and hands it here before anything is written.
 * This route only answers — `lib/plan/readPasted.ts` carries the parse rules
 * as a pure, unit-tested function; this file's own job is the two shapes that
 * need the network (following a Maps link, reverse-geocoding a coordinate)
 * plus the owner gate and the rate limit, the same shape `/api/address-lookup`
 * already uses for the same reason: the browser must not talk to a geocoding
 * provider directly.
 *
 * Cookie only, owner only — `isHelperOwner`/`notYourJournal` is this whole
 * route family's gate, and it never reads an `Authorization` header, so an
 * agent's bearer token gets the same `not_your_journal` answer every other
 * helper route gives it.
 *
 * **The host is checked before any fetch.** `findMapsLink` is a pure host
 * check (`lib/mapsLink.ts`'s own `ALLOWED_HOSTS`) — nothing is
 * fetched until *after* it says yes, and `resolveMapsLink` re-checks the host
 * at every redirect hop on top of that. A URL outside the allow-list, or one
 * `resolveMapsLink` cannot make sense of, answers `{ kind: "link" }` — never
 * an error, and never a second fetch of an unlisted host.
 */

const LIMIT = { max: 30, windowMs: 60 * 1000 };

/** Comfortably longer than any single pasted link, coordinate pair or cost
 * line, and nowhere near what would let this become a general-purpose text
 * endpoint. */
const MAX_TEXT_LEN = 500;

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/plan/read">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limited = rateLimitFor("helper-plan-read", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!body || text.trim() === "") {
    return Response.json({ error: "invalid_text" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return Response.json({ error: "text_too_long" }, { status: 400 });
  }

  const parsed = parsePastedText(text);
  const geocode = isEnabled("addressLookup", user);

  if (parsed.kind === "place") {
    // A Google/Apple Maps URL that already carries its coordinates — B2086.
    // Read off the URL itself, no fetch: following a long google.com link
    // lands on a consent page outside the allow-list and used to answer
    // "a link that is not a map".
    const place = geocode
      ? await reversePlace(parsed.lat, parsed.lng, await requestLocale()).catch(() => null)
      : null;
    const name = parsed.name ?? place?.location;
    return Response.json({
      kind: "place",
      lat: parsed.lat,
      lng: parsed.lng,
      ...(name ? { name } : {}),
      ...(place?.country ? { country: place.country } : {}),
      ...(place?.countryCode ? { countryCode: place.countryCode } : {}),
      source: "maps-link",
    });
  }

  if (parsed.kind === "url") {
    // Host-checked before any fetch — a link naming any other host is
    // answered as a plain link without `resolveMapsLink` ever being called.
    const mapsUrl = findMapsLink(parsed.url);
    const resolved = mapsUrl ? await resolveMapsLink(mapsUrl) : { ok: false as const };
    if (resolved.ok) {
      const place = geocode
        ? await reversePlace(resolved.lat, resolved.lon, await requestLocale()).catch(() => null)
        : null;
      return Response.json({
        kind: "place",
        lat: resolved.lat,
        lng: resolved.lon,
        ...(place?.location ? { name: place.location } : {}),
        ...(place?.country ? { country: place.country } : {}),
        ...(place?.countryCode ? { countryCode: place.countryCode } : {}),
        source: "maps-link",
      });
    }
    return Response.json({ kind: "link", url: parsed.url, title: null });
  }

  if (parsed.kind === "coordinates") {
    const place = geocode
      ? await reversePlace(parsed.lat, parsed.lng, await requestLocale()).catch(() => null)
      : null;
    return Response.json({
      kind: "coordinates",
      lat: parsed.lat,
      lng: parsed.lng,
      ...(place?.country ? { country: place.country } : {}),
      ...(place?.countryCode ? { countryCode: place.countryCode } : {}),
    });
  }

  if (parsed.kind === "cost") {
    return Response.json({
      kind: "cost",
      amount: parsed.amount,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
      label: parsed.label,
      ...(parsed.category ? { category: parsed.category } : {}),
    });
  }

  return Response.json({ kind: "place-query", q: parsed.q });
}

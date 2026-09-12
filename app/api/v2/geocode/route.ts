// POST /api/v2/geocode — a place name into candidate coordinates for a day,
// never one silent guess. B1608, phase 2 step 3. Mirrors v1's
// /api/v1/geocode (app/api/v1/geocode/route.ts) on the new door.
import { geocodePlace, MAX_QUERY_LEN, MIN_QUERY_LEN } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { rateLimitFor } from "@/lib/rateLimit";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { resolveBearer } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { geocodeRequest } from "@/lib/api/v2/schemas/geocode";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;

  // Same rule as v1: the token's own journal, never a `user` the body might
  // otherwise be tempted to name — a trip-scoped token belongs to this
  // journal too, so it may ask for its own trip's candidates.
  const username = bearer.session.owner;
  if (!isEnabled("addressLookup", username)) {
    return fail("address_lookup_disabled", ERROR_CODES.address_lookup_disabled, undefined, 404);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = geocodeRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error), 400);
  }
  const { query, countryHint, regionHint, contextCoordinates } = parsed.data;

  if (query.length < MIN_QUERY_LEN || query.length > MAX_QUERY_LEN) {
    return fail(
      "invalid_request",
      `${ERROR_CODES.invalid_request} query must be ${MIN_QUERY_LEN}-${MAX_QUERY_LEN} characters.`,
      undefined,
      400,
    );
  }

  const limit = rateLimitFor("place-geocode", `${username}:${bearer.session.id}`, { max: 1, windowMs: 1000 });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const locale = request.headers.get("accept-language")?.split(",")[0]?.trim().split("-")[0] ?? "en";
  const results = await geocodePlace(query, locale, {
    countryHint: countryHint || undefined,
    regionHint: regionHint || undefined,
    contextCoordinates,
  });
  if (results === null) {
    return fail(
      "provider_unavailable",
      "The geocoding provider could not be reached, or answered something unusable. Ask the " +
        "person for coordinates directly, or retry in a moment.",
      undefined,
      502,
    );
  }

  return ok({ results }, { headers: { "cache-control": "no-store" } });
}

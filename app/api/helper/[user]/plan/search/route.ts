import { geocodePlace, MAX_QUERY_LEN, MIN_QUERY_LEN } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * "What place is this?" by name — B2011's composer, typing a bare name
 * ("hotel kanra ky…") rather than pasting a link or coordinates.
 * `readPasted.ts`'s own classifier answers those in `kind: "place-query"`;
 * this route is the next step, the same shape
 * `app/api/helper/[user]/plan/read/route.ts` beside it already uses for the
 * network half of B2010: cookie-owner gate, rate limit, then the one
 * server-side geocoder every place lookup here goes through
 * (`lib/addressLookup.ts`'s `geocodePlace` — the same function
 * `/api/v2/geocode` calls for an agent's bearer token; this is that
 * capability's cookie door, same reasoning as `.../plan/read`).
 *
 * Deliberately GET with a query string, not POST: nothing here is written,
 * and the composer calls this on every debounced keystroke.
 */
const LIMIT = { max: 30, windowMs: 60 * 1000 };

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/plan/search">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const limited = rateLimitFor("helper-plan-search", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  if (!isEnabled("addressLookup")) {
    return Response.json({ results: [] });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const trimmed = q.trim();
  if (trimmed.length < MIN_QUERY_LEN || trimmed.length > MAX_QUERY_LEN) {
    return Response.json({ results: [] });
  }

  const results = await geocodePlace(trimmed, await requestLocale());
  return Response.json({ results: results ?? [] });
}

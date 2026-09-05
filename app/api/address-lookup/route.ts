import { NextResponse } from "next/server";
import { lookupAddresses, MAX_QUERY_LEN, MIN_QUERY_LEN } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The address lookup capability's own door — B399.
 *
 * **The browser never talks to the provider.** This route is the only thing
 * that does, which is what keeps a provider key out of the client, keeps
 * the provider from ever seeing a reader's IP or referrer, and gives the
 * rate limit below somewhere to live. Unauthenticated and public on purpose
 * — the four forms it serves are reached before anyone has signed in — which
 * is exactly why it is treated as an abuse surface in its own right rather
 * than as a detail of the contacts feature it happens to serve today.
 *
 * `user` says which journal is asking, purely to answer the capability
 * question (`isEnabled("addressLookup", username)` — a server ceiling and a
 * per-journal opt-in, same as everywhere else). Nothing here reads or writes
 * that journal's own data.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("user") ?? "";
  const query = url.searchParams.get("q") ?? "";
  const locale = url.searchParams.get("locale") ?? "en";

  const user = getUser(username);
  if (!user || !isEnabled("addressLookup", username)) {
    return NextResponse.json({ error: "address_lookup_disabled" }, { status: 404 });
  }

  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LEN) {
    return NextResponse.json({ error: "query_too_short" }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LEN) {
    return NextResponse.json({ error: "query_too_long" }, { status: 400 });
  }

  // Generous enough for a type-ahead's own debounce (one request every few
  // hundred milliseconds while somebody types a street) and nowhere near
  // enough for a script working through a list of addresses.
  const limit = rateLimitFor("address-lookup", clientIp(request), {
    max: 30,
    windowMs: 60 * 1000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const results = await lookupAddresses(trimmed, locale);
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}

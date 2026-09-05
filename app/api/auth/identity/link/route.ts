import { NO_JOURNAL, verifyLink } from "@/lib/auth";
import { setIdentityCookie } from "@/lib/auth/identityCookie";
import { isEnabled } from "@/lib/capabilities";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Spend an identity sign-in link — B430.
 *
 * A `POST`, and that is the whole reason the link lands on a page with a
 * button rather than signing somebody in on arrival. B142: three welcome links
 * on the live instance were spent by the receiving mail host twelve seconds
 * apart, in descending order of creation, before any human had opened
 * anything. Scanners follow links; they do not submit forms.
 *
 * `verifyLink` consumes the link and leaves the six-digit code alive, so a
 * scanner that gets here first costs the reader the button and not the
 * sign-in — they can still type the code.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("auth-identity-link", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return Response.json({ error: "invalid_request" }, { status: 400 });

  const result = await verifyLink(
    NO_JOURNAL,
    token,
    "identity",
    request.headers.get("user-agent"),
  );
  if (!result.ok) {
    // Never a dead end: the root page can issue a fresh code, and says why.
    return Response.json({ error: "link_spent", next: "/?signin=expired" }, { status: 401 });
  }

  await setIdentityCookie(result.token);
  // Home, always. An identity belongs to no journal, so there is no stored
  // destination to honour and nothing for `safeDestination` to widen.
  return Response.json({ ok: true, next: "/" });
}

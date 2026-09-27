import { isNeverInviteToken, suppressInviteToken } from "@/lib/contacts/suppressions";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * The confirm press itself — B2442. See `app/x/[token]/page.tsx` for what
 * the token is and is not. Idempotent (`suppressInviteToken`), so this never
 * fails on a second press; a malformed token 404s rather than silently
 * "succeeding" at nothing.
 *
 * Its own segment (`/x/<token>/confirm`), not `/x/<token>` itself: Next
 * refuses a `route.ts` and a `page.tsx` sharing one segment.
 */
export async function POST(request: Request, context: RouteContext<"/x/[token]/confirm">) {
  const { token } = await context.params;
  if (!isNeverInviteToken(token)) {
    return Response.json({ error: "unknown_token" }, { status: 404 });
  }
  const limit = rateLimitFor("never-invite", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  await suppressInviteToken(token);
  return Response.json({ ok: true });
}

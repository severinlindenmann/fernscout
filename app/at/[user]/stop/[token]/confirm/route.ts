import { resolveSmsStopToken, stopSmsFor } from "@/lib/contacts/smsStop";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** The one write behind the SMS stop page — wants_sms off for one contact of
 * one journal. POST only; the page's GET never changes anything. */
export async function POST(request: Request, context: RouteContext<"/at/[user]/stop/[token]/confirm">) {
  const { user, token } = await context.params;
  const contactId = resolveSmsStopToken(user, token);
  if (!contactId) return Response.json({ error: "unknown_token" }, { status: 404 });
  const limit = rateLimitFor("sms-stop", clientIp(request), { max: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  await stopSmsFor(user, contactId);
  return Response.json({ ok: true });
}

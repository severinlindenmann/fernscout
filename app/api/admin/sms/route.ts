import { isInstanceAdmin } from "@/lib/adminGate";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { SmsApiError, sendSms } from "@/lib/sms";
import { toE164 } from "@/lib/whatsapp/phone";

export const dynamic = "force-dynamic";

/**
 * The operator sends one SMS from the dashboard — B1316.
 *
 * Outside `/api/v1/` deliberately: it takes the admin's cookie only and there
 * is no bearer-token path to it, the same shape the grant and refund routes
 * have. Each send spends the operator's own money on the operator's own
 * number, which is why the gate is `isInstanceAdmin` and nothing weaker.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    // The same answer an unknown route gives.
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-sms", clientIp(request), { max: 20, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = toE164(typeof body.to === "string" ? body.to : "");
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!to) {
    return Response.json(
      { error: "invalid_request", message: 'to must be a full number with its country code, e.g. "+41 76 000 00 00".' },
      { status: 400 },
    );
  }
  if (!text || text.length > 1600) {
    return Response.json(
      { error: "invalid_request", message: "body must be 1–1600 characters." },
      { status: 400 },
    );
  }

  try {
    const result = await sendSms({ to, body: text });
    return Response.json({ ok: true, backend: result.backend, reference: result.reference });
  } catch (err) {
    // The provider's own words reach the operator — a refused send with a
    // reason beats a generic failure on the one page built for this person.
    const message = err instanceof SmsApiError ? err.message : "The message could not be sent.";
    if (!(err instanceof SmsApiError)) console.error("[admin:sms] send failed:", err);
    return Response.json({ error: "send_failed", message }, { status: 502 });
  }
}

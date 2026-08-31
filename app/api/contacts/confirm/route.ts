import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { confirmContact, manageUrl } from "@/lib/contacts";
import { notifyOwnerOfRequest, sendConfirmedMail } from "@/lib/contacts/mail";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The second half of the double opt-in (C12).
 *
 * The code itself is W08's — `confirmContact` calls the same `verifyCode` the
 * sign-in route does, so "ten minutes", "single use" and "five wrong guesses
 * burns it" hold here without being written twice.
 *
 * Confirming is not being approved. What it earns is a place in the queue, a
 * self-serve link, and a note to the owner (C16) so the queue is actually
 * looked at.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-confirm", clientIp(request), {
    max: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!isEmail(email) || code.trim() === "") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await confirmContact(username, email, code);
  // One answer for every failure, exactly as `app/api/auth/verify` does: which
  // of "no code", "expired", "wrong" and "unknown address" applies is precisely
  // what an attacker would like to be told.
  if (!result.ok) return Response.json({ error: "invalid_code" }, { status: 401 });

  await sendConfirmedMail(username, user, result.contact, result.manageToken);
  // Only the first time. Somebody re-confirming to recover their link should
  // not put a second request in front of the owner.
  if (result.firstConfirmation) await notifyOwnerOfRequest(username, user, result.contact);

  return Response.json({
    ok: true,
    status: result.contact.status,
    manageUrl: manageUrl(serverSite().url, username, result.manageToken),
  });
}

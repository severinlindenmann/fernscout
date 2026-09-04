import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { approveContact, confirmContact, manageUrl, markOwnerNotified } from "@/lib/contacts";
import { preapprovedEmailFor } from "@/lib/contacts/invites";
import { notifyOwnerOfRequest, sendApprovedMail, sendConfirmedMail } from "@/lib/contacts/mail";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The second half of the double opt-in (C12).
 *
 * The code itself is W08's — `confirmContact` calls the same `verifyCode` the
 * sign-in route does, so the code window, "single use" and "five wrong guesses
 * burns it" hold here without being written twice.
 *
 * Confirming is not being approved. What it earns is a place in the queue, a
 * self-serve link, and a note to the owner (C16) so the queue is actually
 * looked at.
 *
 * **Unless the address was pre-approved — B319.** An invite the owner asked
 * to have mailed to a named address is that owner vouching for it, so a
 * confirmation that proves *that exact address* skips the queue entirely:
 * `approveContact` runs here instead of leaving the row `pending`, and the
 * reader gets the "you're in" letter rather than "we'll let you know". A
 * confirmation for any other address — including one that arrived through the
 * very same link, forwarded on — takes the ordinary path below. See
 * `preapprovedEmailFor` for why the comparison is safe against a forwarded
 * link.
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

  // B319: does the invite that brought this address here name *this exact
  // address* as one the owner pre-approved? `contact.email` is already
  // case-folded — see `requestContact` — so a straight comparison is enough.
  const preapproved =
    (await preapprovedEmailFor(username, result.contact.createdVia)) === result.contact.email;

  const status = preapproved
    ? ((await approveContact(username, result.contact.id))?.status ?? result.contact.status)
    : result.contact.status;

  // Both best-effort (B272): neither mail may fail this confirmation. The
  // code was right and the row is already updated — an SMTP hiccup from here
  // on is not this reader's problem.
  if (preapproved) {
    // Straight to "you're in" — this address never enters the queue, so
    // there is nothing for `sendConfirmedMail`'s "we'll let you know" to be
    // about and nobody for `notifyOwnerOfRequest` to tell.
    await sendApprovedMail(username, user, result.contact);
  } else {
    await sendConfirmedMail(username, user, result.contact, result.manageToken);
    // Only while the owner has not actually been told. That is
    // `needsOwnerNotice` rather than `firstConfirmation`: a re-confirmation
    // whose earlier owner mail failed still needs one, and `notified_at`
    // only turns true once the send actually lands — so this never puts a
    // *second* request in front of the owner, only retries a first one that
    // never arrived.
    if (result.needsOwnerNotice) {
      const notified = await notifyOwnerOfRequest(username, user, result.contact);
      if (notified) await markOwnerNotified(username, result.contact.id);
    }
  }

  return Response.json({
    ok: true,
    status,
    manageUrl: manageUrl(serverSite().url, username, result.manageToken),
  });
}

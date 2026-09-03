import { isEmail, issueCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { requestContact } from "@/lib/contacts";
import { EMPTY_ADDRESS, isPostable, normaliseAddress } from "@/lib/contacts/crypto";
import { resolveInvite } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { sendCodeMail } from "@/lib/contacts/mail";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Somebody the owner invited filled in their details.
 *
 * Three guards, for three different attacks:
 *
 * - **A live invite token** (B37). This used to be optional: no token meant
 *   `createdVia: "open"`, and anybody who had ever seen the request could put
 *   a stranger on the owner's queue. Removing the page it was posted from
 *   would have left the door standing with the sign taken down, so the token
 *   is required here — where it is actually enforced — and only
 *   `resolveInvite` says whether one is live.
 * - **A rate limit** (C15), because this form asks for postal addresses and
 *   those attract junk. Five submissions per address per quarter of an hour is
 *   far more than a household filling it in together and far less than a
 *   script.
 * - **A uniform answer.** Malformed input is named — a reader who mistyped
 *   their address deserves to be told — but everything else answers `202`,
 *   whether the contact is new, already known, blocked, or arrived with a
 *   token that was revoked yesterday. Anything else turns the form into a way
 *   of asking who else is on the list, or into an oracle for testing whether a
 *   link is still live.
 *
 * Nothing here grants anything. The row it writes is `pending`, and the only
 * thing that happens next is a six-digit code. A person still approves it by
 * hand; an invite is an invitation to request, never a grant.
 */
/**
 * One name on the wire.
 *
 * This endpoint took `wantsDigest` while the record, the admin API, the manage
 * page and every response said `wantsEmailDigest` — so anything that read a
 * contact back and posted the same field name got a reader silently opted out
 * of the digest, with no error to notice. `wantsEmailDigest` is the name now;
 * the old one is still read, because links and scripts already send it.
 */
function digestPreference(body: Record<string, unknown>): boolean | undefined {
  if (typeof body.wantsEmailDigest === "boolean") return body.wantsEmailDigest;
  if (typeof body.wantsDigest === "boolean") return body.wantsDigest;
  return undefined;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-request", clientIp(request), {
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email : "";
  if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });
  if (!isEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });

  const wantsPostcard = body.wantsPostcard === true;
  const address = normaliseAddress(
    typeof body.address === "object" && body.address !== null
      ? (body.address as Record<string, unknown>)
      : null,
  );
  // Asking for a postcard with nowhere to send it is a mistake worth naming,
  // rather than a preference worth storing.
  if (wantsPostcard && !isPostable(address)) {
    return Response.json({ error: "invalid_address" }, { status: 400 });
  }

  // A phone number is not a postal address (task 10). The client is not the
  // boundary — a submission could tick `wantsPostcard: false` while still
  // sending a full street address, deliberately or otherwise — so this route
  // decides for itself what to keep: the full submitted address when the
  // postcard box is ticked, otherwise only the phone number, never `null`.
  // `requestContact` decides whether that is worth persisting at all via
  // `hasAnyDetail`, so neither a tel nor a postcard still stores nothing.
  const addressToStore = wantsPostcard ? address : { ...EMPTY_ADDRESS, tel: address.tel };

  // The token in a personal link prefills two fields, says which link somebody
  // came through, and is now also what makes them admissible at all. It is
  // still not identity: the *submitted* address is what identifies this
  // person, never the invite.
  const inviteToken = typeof body.invite === "string" ? body.invite : "";
  const invite = inviteToken ? await resolveInvite(username, inviteToken) : null;

  // Missing, invented, expired or revoked — all four end here, writing
  // nothing, sending nothing, and answering exactly what a good token gets. A
  // caller cannot tell the four apart from each other or from success, which
  // is the point: otherwise this route answers "is that link still live?" for
  // anybody who asks.
  //
  // A **buddy** token joins them (B33), and for a different reason. This form
  // records nothing about a trip, so accepting one here would quietly turn a
  // request to come along on the bus into a request to read the journal — the
  // person would be approved, find they still could not write, and have no way
  // to tell what went wrong. Buddy links have their own door,
  // `/api/contacts/redeem`, and this one is not it.
  if (!invite || invite.kind === "buddy") {
    return Response.json({ status: "accepted" }, { status: 202 });
  }

  const locale = pickLocale(
    typeof body.locale === "string" ? body.locale : null,
    invite.locale,
    user.defaultLocale,
  );

  const result = await requestContact(username, {
    name,
    email,
    locale,
    address: addressToStore,
    wantsEmailDigest: digestPreference(body) === true,
    wantsPostcard,
    createdVia: `invite:${invite.id}`,
    inviteId: invite.id,
  });

  if (result.outcome !== "ignored") {
    const { code } = await issueCode(username, email, "guest");
    await sendCodeMail(username, user, email, locale, code);
  }

  return Response.json({ status: "accepted" }, { status: 202 });
}

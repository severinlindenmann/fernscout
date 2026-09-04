import { isEmail, issueCode } from "@/lib/auth";
import { hasSwitchedOff, isEnabled } from "@/lib/capabilities";
import {
  confirmContactFromSession,
  getContactByEmail,
  markOwnerNotified,
  requestContact,
} from "@/lib/contacts";
import { EMPTY_ADDRESS, isPostable, normaliseAddress } from "@/lib/contacts/crypto";
import { resolveInvite } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendCodeMail, sendConfirmedMail } from "@/lib/contacts/mail";
import { journalReader } from "@/lib/contacts/session";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { claimTripPlace } from "@/lib/tripPeople";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Somebody redeemed a guest or a buddy link — B33.
 *
 * **Redeeming is asking.** It writes the same `pending` contact
 * `requestContact` has always written, and `approveContact` remains the only
 * thing that turns that into access. A buddy link additionally writes a
 * request to join one trip, which reads as nothing at all until the same
 * approval. That is what makes both links safe to forward: the link decides
 * who may ask, the owner decides who gets in — decision 19, unchanged.
 *
 * ## What a redemption asks for
 *
 * Two things it always needs. **An address, proved**, and **a name to put
 * beside it**. That is the whole of what being let into a journal needs, and
 * a returning reader — one already known to this journal, by a session or by
 * email — is asked for nothing beyond them: no digest tick, and (since B273)
 * no postal address or phone number either, because a redemption that quietly
 * rewrote a choice somebody already made would be a form doing something
 * nobody asked it to. Those still have their own page,
 * `/{user}/c/<token>`, where they can be added, corrected or removed in the
 * open.
 *
 * A **brand-new** reader — no session, no existing row for the address they
 * typed — sees more: a postal address and a phone number, both optional,
 * exactly like the guestbook at `/{user}/i/<token>`. There is no existing
 * choice for that screen to overwrite, so offering the two together at the
 * moment somebody first asks in saves them a second trip to the manage page
 * later — which is the gap B273 was filed over.
 *
 * Each of the two identity fields is skipped when it is already known:
 *
 * - **Signed in to this journal already?** Then the address is proved — the
 *   cookie was minted by `verifyCode` against a code mailed to it — and this
 *   is one confirmation rather than a form and a second code. See
 *   `confirmContactFromSession`.
 * - **Known here already?** The name on the existing contact stands; an empty
 *   `name` never overwrites one. And there is no second record: `requestContact`
 *   is keyed on the address, so somebody who already owns a journal on this
 *   instance, or is already a guest of this one, updates the row they have.
 *
 * A session for a *different* journal on this instance is deliberately not
 * treated as proof. Sessions belong to one journal — that is what
 * `session.owner` is checked for everywhere — and a cross-journal shortcut
 * would be inventing an instance-wide identity that nothing else here has.
 * What such a visitor gets is a prefilled form and one code, not a second
 * registration.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-redeem", clientIp(request), {
    max: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  const invite = token ? await resolveInvite(username, token) : null;
  const wanted = typeof body.kind === "string" ? body.kind : "";

  /**
   * Missing, invented, expired, revoked — or the wrong kind for the page it
   * was posted from, which is a buddy token presented as a guest one or the
   * reverse. All of them end here, writing nothing.
   *
   * Answered plainly rather than with `/api/contacts/request`'s uniform 202.
   * That route is a public form and its silence is what stops it being an
   * oracle for "is this link still live"; here the landing page has already
   * said so in words, because a redemption form that appeared to work and did
   * nothing leaves somebody waiting for a reply that was never coming — the
   * exact failure B37 refused to ship. Matching the page adds no disclosure
   * the page did not already make.
   */
  if (!invite || invite.kind !== wanted) {
    return Response.json({ status: "expired" }, { status: 202 });
  }
  if (invite.kind === "buddy" && !invite.tripId) {
    return Response.json({ status: "expired" }, { status: 202 });
  }
  // A buddy link whose trip has since been deleted. `deleteTrip` sweeps rows
  // carrying a `trip_id`, so this is a narrow race rather than a normal state
  // — but a request to join a trip that is not there would sit in the owner's
  // queue meaning nothing.
  if (invite.tripId && !getTrip(tripRef(username, invite.tripId))) {
    return Response.json({ status: "expired" }, { status: 202 });
  }

  // The address on a session for *this* journal, if there is one. Never read
  // from the body: that is the difference between proving an address and
  // typing one.
  const reader = await journalReader(username);
  const sessionEmail = reader.email;

  /**
   * No session, so this redemption ends in a six-digit code — and the code has
   * to be sendable before anything is written. B205, the same shape B160
   * removed from `POST /api/auth/request`.
   *
   * With mail off, `sendCodeMail` returns null without sending and the reader
   * was told `{"status":"code"}` all the same: an inbox nothing will ever
   * arrive in. It cost more than a wasted wait, because `issueCode` consumes
   * every live code for that address before writing a new one
   * (`lib/auth/index.ts:254`) — so somebody who already held a working code
   * lost it to a code nobody was ever told. Refusing here, **before**
   * `issueCode` and before `requestContact`, means a redemption that cannot
   * finish also does not take anything away.
   *
   * Both switches, because `sendCodeMail` goes through `sendMail`, which
   * honours both: the server's `isEnabled("mail")` and the journal's own
   * `features.mail.enabled: false`. Checking only the first would leave the
   * identical promise standing for a journal that switched mail off.
   *
   * It discloses nothing this route was keeping: an invalid, expired or
   * mismatched token has already been answered `202 {"status":"expired"}`
   * above, so "this token is live" is something the endpoint says either way —
   * deliberately, and for the reason written there. What the answer does not
   * vary with is the address: every caller with a live token gets this, so it
   * is not a way to ask whether somebody is known here or has been blocked.
   *
   * The signed-in branch below is deliberately not refused. It issues no code
   * and promises no inbox — `sendConfirmedMail` and `notifyOwnerOfRequest` are
   * courtesies — and the request it files is real work that mail being off
   * does not undo.
   */
  if (!sessionEmail && (!isEnabled("mail") || hasSwitchedOff("mail", username))) {
    return Response.json(
      {
        error: "mail_disabled",
        message:
          "This server cannot send the six-digit code that redeeming a link needs, so nothing " +
          "was written and no code was issued — including any code you already hold, which is " +
          "still live. The person who runs this server has to turn mail on; /api/health says " +
          "why it is off.",
      },
      { status: 503 },
    );
  }

  const submitted = typeof body.email === "string" ? body.email : "";
  const email = sessionEmail ?? submitted;
  if (!isEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });

  const submittedName = typeof body.name === "string" ? body.name.trim() : "";
  const known = reader.contact ?? (await getContactByEmail(username, email));
  // Their own name first, then what the existing record says, then the name
  // the owner wrote into the link. An empty result is refused rather than
  // stored: the owner is about to decide about a person, and a row with no
  // name on it is a decision they cannot make.
  const name = submittedName || known?.name || invite.name || "";
  if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });

  const locale = pickLocale(
    typeof body.locale === "string" ? body.locale : null,
    known?.locale ?? invite.locale,
    user.defaultLocale,
  );

  /**
   * Whether the "form" step sent one — B273. Gated on `!sessionEmail` rather
   * than merely on the body carrying one: the confirm step's whole point is
   * that a reader already proved by session is never asked about their
   * address again, and that has to hold even against a request built by hand
   * rather than by this component — the client is not the boundary. A
   * brand-new reader's form always sends an address, even an entirely blank
   * object; that is deliberately not "was every field filled in" — an object
   * with nothing in it is still a real answer (see `hasAnyDetail`), the same
   * way `null` from `/api/contacts/request` is.
   */
  const addressProvided =
    !sessionEmail && typeof body.address === "object" && body.address !== null;
  const wantsPostcard = body.wantsPostcard === true;
  const submittedAddress = normaliseAddress(
    addressProvided ? (body.address as Record<string, unknown>) : null,
  );
  // Asking for a postcard with nowhere to send it is a mistake worth naming,
  // rather than a preference worth storing — same rule `/api/contacts/request`
  // applies to the guestbook.
  if (addressProvided && wantsPostcard && !isPostable(submittedAddress)) {
    return Response.json({ error: "invalid_address" }, { status: 400 });
  }
  // A phone number is not a postal address: keep the full submission only
  // when the postcard box is ticked, otherwise only the phone number, never
  // `null` — `requestContact`'s `hasAnyDetail` decides whether that is worth
  // persisting at all.
  const addressToStore = wantsPostcard
    ? submittedAddress
    : { ...EMPTY_ADDRESS, tel: submittedAddress.tel };

  const result = await requestContact(username, {
    name,
    email,
    locale,
    // `undefined` for an already-known reader's confirm step — never asked,
    // never answered, exactly as before B273. A brand-new reader's form step
    // sent an address (see `addressProvided` above), so it is written.
    address: addressProvided ? addressToStore : undefined,
    wantsEmailDigest: known?.wantsEmailDigest ?? false,
    wantsPostcard: addressProvided ? wantsPostcard : (known?.wantsPostcard ?? false),
    createdVia: `invite:${invite.id}`,
    inviteId: invite.id,
  });

  // A blocked address that followed a link. Answered like a success, so the
  // link is not a way of discovering that somebody was shown the door.
  if (result.outcome === "ignored") {
    return Response.json({ status: sessionEmail ? "waiting" : "code" }, { status: 202 });
  }

  if (invite.kind === "buddy" && invite.tripId) {
    await claimTripPlace(username, invite.tripId, result.contactId, invite.id);
  }

  if (!sessionEmail) {
    // The ordinary path: prove the address with the same six digits every
    // other door here uses, then `/api/contacts/confirm`.
    const { code } = await issueCode(username, email, "guest");
    await sendCodeMail(username, user, email, locale, code);
    return Response.json({ status: "code" }, { status: 202 });
  }

  // Signed in here already, so the address needs no second proof.
  const confirmed = await confirmContactFromSession(username, sessionEmail);
  if (!confirmed.ok) return Response.json({ status: "waiting" }, { status: 202 });

  // Both best-effort (B272), same as `/api/contacts/confirm` — see there.
  await sendConfirmedMail(username, user, confirmed.contact, confirmed.manageToken);
  // Only while the owner has not actually been told, not only the first time:
  // a re-following of the link whose earlier notification mail failed still
  // needs one, and `notified_at` only turns true once it lands — so this
  // never puts a second request in front of the owner.
  if (confirmed.needsOwnerNotice) {
    const notified = await notifyOwnerOfRequest(username, user, confirmed.contact);
    if (notified) await markOwnerNotified(username, confirmed.contact.id);
  }

  return Response.json(
    {
      // `active` means the owner had already let them in and there is nothing
      // to wait for. They proved this address to get here, so telling them the
      // truth about their own row discloses nothing.
      status: confirmed.contact.status === "active" ? "in" : "waiting",
    },
    { status: 202 },
  );
}

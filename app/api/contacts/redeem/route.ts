import { isEmail, issueCode } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { mailDisabledReason } from "@/lib/mail";
import {
  approveContact,
  confirmContactFromSession,
  getContactByEmail,
  markOwnerNotified,
  requestContact,
} from "@/lib/contacts";
import { EMPTY_ADDRESS, hasAnyDetail, isPostable, normaliseAddress } from "@/lib/contacts/crypto";
import { preapprovedEmailFor, resolveInvite } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { notifyOwnerOfRequest, sendApprovedMail, sendCodeMail, sendConfirmedMail } from "@/lib/contacts/mail";
import { journalReader } from "@/lib/contacts/session";
import { clientIp, rateLimitFor, rateLimitStatus } from "@/lib/rateLimit";
import { getTrip, tripRef } from "@/lib/trips";
import { claimTripPlace } from "@/lib/tripPeople";
import { getUser } from "@/lib/users";
import { isMessageable } from "@/lib/whatsapp/phone";
import { whatsappCountryCode } from "@/lib/whatsapp/settings";

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
 * email — is asked for nothing beyond them: no digest tick, no postal address
 * and no phone number, because a redemption that quietly rewrote a choice
 * somebody already made would be a form doing something nobody asked it to.
 * **A brand-new reader is the other case and always was**: B273 gave them the
 * address and the phone number, B315 the digest tick, because there is no
 * earlier answer of theirs to overwrite. Both are read only when
 * `addressProvided` — see below. A returning reader's own page is still
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
 *
 * **One exception to "redeeming is asking" — B319.** When the invite names an
 * address the owner asked to have it mailed to, and the session's own address
 * matches it exactly, `approveContact` runs the moment this branch confirms
 * rather than waiting for the owner. See `preapprovedEmailFor` and the
 * confirming branch below. A session for any other address — including a
 * forwarded copy of the same link — is unaffected by this and asks exactly as
 * it always has.
 */
export async function POST(request: Request) {
  const ip = clientIp(request);

  /**
   * Two budgets, because completing a redemption and mistyping a form field
   * are not the same act — B237, the same shape B217 gives creating a
   * journal. The old single bucket spent one of five slots per **attempt**,
   * before anything about the submission was looked at, so correcting a
   * typo'd address twice was three of five and a wrong code away from
   * locking somebody out of their own invitation.
   *
   * `REDEEMED` is spent only where a redemption actually completes — a code
   * mailed, or a signed-in reader confirmed — which is the expensive act:
   * mail sent, or a row written that puts somebody in the owner's queue.
   * `REFUSED` is spent by every other way out of this route, `refuse()`
   * below, so a run of invented tokens or malformed bodies still costs —
   * this route resolves invite tokens, and that is what guessing one looks
   * like — without spending the budget a person correcting their own typing
   * needs.
   */
  const REDEEMED = { max: 5, windowMs: 15 * 60 * 1000 };
  const REFUSED = { max: 20, windowMs: 15 * 60 * 1000 };

  const redeemedBudget = rateLimitStatus("contacts-redeem", ip, REDEEMED);
  if (!redeemedBudget.ok) return tooMany("redeemed", redeemedBudget.retryAfter);
  const refusedBudget = rateLimitStatus("contacts-redeem-refused", ip, REFUSED);
  if (!refusedBudget.ok) return tooMany("refused", refusedBudget.retryAfter);

  /**
   * Every way this route says no or gives up on a submission, and the only
   * thing that spends the refusal budget — mirrors `refuse()` in
   * `POST /api/v1/journals`.
   */
  const refuse = (body: Record<string, unknown>, status: number): Response => {
    rateLimitFor("contacts-redeem-refused", ip, REFUSED);
    return Response.json(body, { status });
  };

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const user = getUser(username);

  if (!user || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
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
    return refuse({ status: "expired" }, 202);
  }
  if (invite.kind === "buddy" && !invite.tripId) {
    return refuse({ status: "expired" }, 202);
  }
  // A buddy link whose trip has since been deleted. `deleteTrip` sweeps rows
  // carrying a `trip_id`, so this is a narrow race rather than a normal state
  // — but a request to join a trip that is not there would sit in the owner's
  // queue meaning nothing.
  if (invite.tripId && !getTrip(tripRef(username, invite.tripId))) {
    return refuse({ status: "expired" }, 202);
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
  const mailOff = sessionEmail ? null : mailDisabledReason(username);
  if (mailOff) {
    return refuse(
      {
        error: "mail_disabled",
        // B429: which switch, machine-readably — `redeemOutcome` reads this
        // to pick between two reader-facing sentences rather than the one
        // canned line both used to collapse into. `message` below still
        // carries the full, human sentence for anything reading this
        // response directly.
        reason: mailOff,
        // B407: name the switch that is actually off, and point at the one
        // that can be changed. A journal's own `features.mail.enabled: false`
        // is not the server's problem, and telling an owner to look at a
        // healthy `/api/health` teaches them nothing.
        message:
          mailOff === "journal"
            ? "This journal's own mail is switched off, so there is no way to send you the " +
              "six-digit code that redeeming a link needs — nothing was written and no code " +
              "was issued, including any code you already hold, which is still live. The " +
              "owner can turn it back on through PATCH /api/v1/<user>/config."
            : "This server cannot send the six-digit code that redeeming a link needs, so nothing " +
              "was written and no code was issued — including any code you already hold, which is " +
              "still live. The person who runs this server has to turn mail on; /api/health says " +
              "why it is off.",
      },
      503,
    );
  }

  const submitted = typeof body.email === "string" ? body.email : "";
  const email = sessionEmail ?? submitted;
  if (!isEmail(email)) return refuse({ error: "invalid_email" }, 400);

  const submittedName = typeof body.name === "string" ? body.name.trim() : "";
  const known = reader.contact ?? (await getContactByEmail(username, email));
  // Their own name first, then what the existing record says, then the name
  // the owner wrote into the link. An empty result is refused rather than
  // stored: the owner is about to decide about a person, and a row with no
  // name on it is a decision they cannot make.
  const name = submittedName || known?.name || invite.name || "";
  if (name === "") return refuse({ error: "invalid_name" }, 400);

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
  const formStep =
    !sessionEmail && typeof body.address === "object" && body.address !== null;
  /**
   * B1282 — a wholly blank submission is not the same claim for an address
   * this journal already holds one for. The "form" step used to prefill
   * nothing — see `redeemPage.tsx` — so an empty object here was silence,
   * not "delete this", and `requestContact` below was reading it as the
   * latter and NULLing a postal address the owner had entered before ever
   * inviting her. The client is prefilled now (`redeemPage.tsx` /
   * `InviteRedeem`), but the client is not the boundary any more than the
   * comment above says it is for the confirm step: a hand-built request with
   * a blank `address` for a `known` email must not be able to do what a
   * blank form used to do by accident.
   * So a submission with nothing at all in it (`hasAnyDetail` false) is
   * honoured as "provided" only when there was nothing on file to begin
   * with — a genuinely brand-new address, where blank means blank and
   * stores nothing, exactly as before. Typing so much as one field is still
   * always honoured, which is what lets her correct or deliberately clear
   * what is shown.
   */
  const submittedRaw = normaliseAddress(
    formStep ? (body.address as Record<string, unknown>) : null,
  );
  const addressProvided = formStep && (hasAnyDetail(submittedRaw) || !known?.hasPostalAddress);
  const wantsPostcard = body.wantsPostcard === true;
  /**
   * The digest tick, on the same terms — B315.
   *
   * Gated on `addressProvided` rather than on the body carrying the field,
   * for the reason the block above gives: the confirm step must never answer
   * for a reader who already chose, and that has to hold against a
   * hand-built request as much as against this component's. So a body that
   * sends `wantsEmailDigest` on the confirm path is ignored, not honoured.
   *
   * The form step's box is ticked by default, so the common answer here is
   * `true`; it is still read from the body rather than assumed, because a
   * reader who unticked it means it.
   */
  const wantsEmailDigest = addressProvided
    ? body.wantsEmailDigest === true
    : (known?.wantsEmailDigest ?? false);
  const submittedAddress = normaliseAddress(
    addressProvided ? (body.address as Record<string, unknown>) : null,
  );
  // Asking for a postcard with nowhere to send it is a mistake worth naming,
  // rather than a preference worth storing — same rule `/api/contacts/request`
  // applies to the guestbook.
  if (addressProvided && wantsPostcard && !isPostable(submittedAddress)) {
    return refuse({ error: "invalid_address" }, 400);
  }
  // The WhatsApp tick, on exactly the terms `wantsPostcard` gets: honoured
  // only on the form step, ignored on the confirm step so this route can
  // never answer a channel question for a reader who already chose.
  const wantsWhatsapp = addressProvided ? body.wantsWhatsapp === true : false;
  if (wantsWhatsapp && !isMessageable(submittedAddress.tel, whatsappCountryCode())) {
    return refuse({ error: "invalid_phone" }, 400);
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
    wantsEmailDigest,
    wantsPostcard: addressProvided ? wantsPostcard : (known?.wantsPostcard ?? false),
    wantsWhatsapp: addressProvided ? wantsWhatsapp : (known?.wantsWhatsapp ?? false),
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
    // other door here uses, then `/api/contacts/confirm`. This is the
    // expensive act `REDEEMED` above is counting — mail sent, a code that
    // burns whatever the reader was already holding.
    //
    // B798: the code is mailed with a one-click link beside it, and the link
    // comes back **here** — `/{user}/invite/<kind>/<token>`, the page they are
    // standing on. Pressing it signs the address in (through `/{user}/s/…`,
    // which is a button rather than a GET — see B142) and lands them back on
    // this same landing page, now with a session, where `RedeemPage` shows the
    // one-button "confirm" step instead of the six-digit form. So the whole
    // journey is: name and address, one press in the mail, one press to
    // confirm. Nothing is typed twice and nothing is transcribed between two
    // apps.
    //
    // **Nothing about what a redemption grants changes.** The session the link
    // mints is an address, not a permission (`mayReadTrip` still asks
    // `isJournalGuest`), and the confirm step still ends at a `pending` row
    // with `approveContact` the only thing that can open it — *unless* the
    // address is pre-approved, in which case `/api/contacts/confirm` opens it
    // the moment the code is proved. B1132: the mail has to say which of
    // those is true, checked the same way the signed-in branch below checks
    // it, against this contact's own `createdVia` and current `status`.
    const contactNow = await getContactByEmail(username, email);
    const preapproved =
      contactNow !== null &&
      (await preapprovedEmailFor(username, contactNow.createdVia, contactNow.status)) ===
        contactNow.email;
    const { code, linkToken } = await issueCode(username, email, "guest", {
      destination: `/${username}/invite/${invite.kind}/${token}`,
    });
    await sendCodeMail(username, user, email, locale, code, linkToken, preapproved);
    rateLimitFor("contacts-redeem", ip, REDEEMED);
    return Response.json({ status: "code" }, { status: 202 });
  }

  // Signed in here already, so the address needs no second proof.
  const confirmed = await confirmContactFromSession(username, sessionEmail);
  if (!confirmed.ok) return Response.json({ status: "waiting" }, { status: 202 });
  // Reached the queue — the second shape of completion `REDEEMED` counts.
  rateLimitFor("contacts-redeem", ip, REDEEMED);

  // B319: the same address check `/api/contacts/confirm` makes — see there
  // for why comparing to the invite's own `email_key` is safe against a
  // forwarded link.
  const preapproved =
    (await preapprovedEmailFor(username, confirmed.contact.createdVia, confirmed.contact.status)) ===
    confirmed.contact.email;
  const status = preapproved
    ? ((await approveContact(username, confirmed.contact.id))?.contact.status ??
      confirmed.contact.status)
    : confirmed.contact.status;

  // Both best-effort (B272), same as `/api/contacts/confirm` — see there.
  if (preapproved) {
    await sendApprovedMail(username, user, confirmed.contact);
  } else {
    await sendConfirmedMail(username, user, confirmed.contact, confirmed.manageToken);
    // Only while the owner has not actually been told, not only the first
    // time: a re-following of the link whose earlier notification mail
    // failed still needs one, and `notified_at` only turns true once it
    // lands — so this never puts a second request in front of the owner.
    if (confirmed.needsOwnerNotice) {
      const notified = await notifyOwnerOfRequest(username, user, confirmed.contact);
      if (notified) await markOwnerNotified(username, confirmed.contact.id);
    }
  }

  return Response.json(
    {
      // `active` means the owner had already let them in — whether they
      // already had, or the pre-approval above just did it in this same
      // request — and there is nothing to wait for. They proved this address
      // to get here, so telling them the truth about their own row discloses
      // nothing. This is a fact about the *journal*, not about any one trip:
      // an already-active reader whose buddy link was correctly refused
      // pre-approval above (B1301) is still told "in" here, exactly as
      // `test/invite-links.test.ts`'s "signed in here, a redemption is one
      // confirmation and no form at all" expects — the trip place itself
      // stays a request either way, visible to the owner through
      // `pendingTripRequestsFor` and to the reader through `isPersonOn`
      // (see that test's next case), never through this field.
      status: status === "active" ? "in" : "waiting",
    },
    { status: 202 },
  );
}

function tooMany(reason: "redeemed" | "refused", retryAfter: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return Response.json(
    {
      error: "too_many_requests",
      reason,
      retryAfter,
      message:
        reason === "redeemed"
          ? "Five links have already been redeemed from this network address in the last " +
            "fifteen minutes, which is the limit. If somebody in your household got in first, " +
            "that is not a mistake — try again in " +
            `${minutes} minute${minutes === 1 ? "" : "s"}.`
          : "Too many attempts from this network address were refused in the last fifteen " +
            "minutes — an expired or invented link, or a form with something wrong on it — so " +
            "this one was not tried. Correcting a name or an address is not what spent this: " +
            `it is the guessing that has stopped. Try again in ${minutes} ` +
            `minute${minutes === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

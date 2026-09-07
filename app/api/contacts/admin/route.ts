import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { rateLimitFor } from "@/lib/rateLimit";
import {
  approveContact,
  confirmContactFromSession,
  deleteContact,
  getContact,
  listContacts,
  normaliseEmail,
  requestContact,
  revokeContact,
  updateContactByOwner,
  type ContactRecord,
} from "@/lib/contacts";
import {
  EMPTY_ADDRESS,
  hasAnyDetail,
  isPostable,
  normaliseAddress,
  type PostalAddress,
} from "@/lib/contacts/crypto";
import {
  createInvite,
  inviteExpiry,
  inviteLinkUrl,
  listInvitesWithLinks,
  revokeInvite,
  type Invite,
} from "@/lib/contacts/invites";
import { contactsWithReadGrant } from "@/lib/grants";
import { pickLocale } from "@/lib/contacts/locale";
import { sendApprovedMail, sendInviteMail } from "@/lib/contacts/mail";
import { relationshipsFor, type ContactRelationship } from "@/lib/contacts/relationships";
import { isOwner } from "@/lib/contacts/session";
import { deviceCountByContact } from "@/lib/push";
import { serverSite } from "@/lib/site";
import { peopleOf } from "@/lib/tripPeople";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The admin surface behind the page (C6).
 *
 * Every path through here begins with `isOwner`. There is no "read-only"
 * variant and no listing that a reader may see a filtered version of: this
 * endpoint returns names, addresses and home addresses, so the only safe answer
 * to anybody else is nothing at all.
 */

/** What the owner sees. The address is included — they are the one person
 * besides its owner entitled to it, and they need it to post anything. */
function ownerView(
  contact: ContactRecord,
  devices: Record<string, number> | null = null,
  // B630 — read by the client only off the *list* (`GET`, below). Every POST
  // here always ends with a `refresh()` that re-fetches that list, so the
  // per-action responses pass nothing and a row's tag never comes from a
  // second, narrower answer.
  relationship: ContactRelationship | null = null,
) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    locale: contact.locale,
    status: contact.status,
    wantsEmailDigest: contact.wantsEmailDigest,
    wantsPostcard: contact.wantsPostcard,
    wantsWhatsapp: contact.wantsWhatsapp,
    hasPostalAddress: contact.hasPostalAddress,
    postalAddress: contact.postalAddress,
    /** B453 — see the page, which shapes the first render of this. `null` is
     * push being off for this journal and is not the same as nobody having
     * subscribed. Passed in rather than looked up per contact: one read
     * answers for the whole list. */
    pushDevices: devices ? (devices[contact.id] ?? 0) : null,
    createdVia: contact.createdVia,
    createdAt: contact.createdAt,
    confirmedAt: contact.confirmedAt,
    approvedAt: contact.approvedAt,
    lastSeenAt: contact.lastSeenAt,
    relationship,
  };
}

/**
 * One link, as the page renders it — B97.
 *
 * `listInvites` already returned all of this and the route already passed it
 * through; what dropped `kind`, `tripId` and `expiresAt` was the type on the
 * other side. Shaped explicitly here anyway, the way `ownerView` is: the
 * fields the guest list needs are then a stated contract rather than whatever
 * `Invite` happens to hold, and the one thing that must never appear — the
 * token — cannot arrive by a column being added upstream. Only its hash was
 * ever stored, so there is nothing here to leak; that is worth keeping true by
 * construction.
 */
function inviteView(invite: Invite & { url?: string | null }) {
  return {
    id: invite.id,
    kind: invite.kind,
    tripId: invite.tripId,
    name: invite.name,
    locale: invite.locale,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    uses: invite.uses,
    // The one field here that is a credential — B280. It comes from
    // `listInvitesWithLinks` and reaches only this route and the owner's own
    // page; `GET /api/v1/{user}/invites`, which an agent bearer token also
    // reaches, deliberately does not carry it. `guard` below is owner-only,
    // cookie or token, which is what makes that safe.
    url: invite.url ?? null,
  };
}

async function guard(username: string, request: Request): Promise<Response | null> {
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }
  if (!(await isOwner(username, request))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const username = new URL(request.url).searchParams.get("user") ?? "";
  const denied = await guard(username, request);
  if (denied) return denied;

  const devices = isEnabled("push", username) ? await deviceCountByContact(username) : null;

  // B630, mirroring the page's own version of this: the same three facts the
  // gates ask, read once for the whole list rather than per row, so `refresh()`
  // after an approve or a revoke shows a tag that still matches what the
  // action just changed.
  const user = getUser(username)!;
  const ownEmail = user.owner.email ? normaliseEmail(user.owner.email) : null;
  const trips = getTrips(username);
  const tripMemberships = await Promise.all(
    trips.map(async (trip) => ({ id: trip.id, title: trip.title, people: await peopleOf(trip) })),
  );
  const liveGrants = await contactsWithReadGrant(username, new Date());

  return Response.json({
    contacts: (await listContacts(username)).map((contact) =>
      ownerView(
        contact,
        devices,
        relationshipsFor(
          contact.email,
          ownEmail,
          tripMemberships,
          contact.status === "active" && liveGrants.has(contact.id),
        ),
      ),
    ),
    invites: (await listInvitesWithLinks(username, serverSite().url)).map(inviteView),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user : "";
  const denied = await guard(username, request);
  if (denied) return denied;

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";

  switch (action) {
    case "approve": {
      const result = await approveContact(username, id);
      // Refused rather than silently ignored: approving an address nobody has
      // proved they can read is how an owner gets talked into leaking a trip.
      if (!result) return Response.json({ error: "not_confirmed" }, { status: 409 });
      const { contact, tripsOpened } = result;
      await sendApprovedMail(username, getUser(username)!, contact);
      // B244 — name what this click actually did, not only that it worked.
      // Approving is the strongest thing this page does (AGENTS.md: a buddy
      // link is "the stronger of the two"), and it can silently re-open a
      // trip a `revokeContact` closed months ago (B213). Titles rather than
      // ids, same reasoning as `viaLabel` above: the owner reads this, not an
      // agent, and an id they never chose to remember is not what they parse.
      const tripsOpenedTitles = tripsOpened.map(
        (tripId) => getTrip(tripRef(username, tripId))?.title ?? tripId,
      );
      return Response.json({
        ok: true,
        contact: ownerView(contact),
        tripsOpened: tripsOpenedTitles,
      });
    }
    case "revoke": {
      const contact = await revokeContact(username, id);
      if (!contact) return Response.json({ error: "unknown_contact" }, { status: 404 });
      return Response.json({ ok: true, contact: ownerView(contact) });
    }
    case "delete": {
      const gone = await deleteContact(username, id);
      if (!gone) return Response.json({ error: "unknown_contact" }, { status: 404 });
      return Response.json({ ok: true, deleted: true });
    }
    // `case "invite"` was here, and it made a `personal` link — the only kind
    // this panel could make, while the two an owner actually hands out were
    // made on `/{user}/me` by a different component. B281 removed it rather
    // than growing a second copy of the validation: the panel now posts to
    // `POST /api/v1/{user}/invites`, which already refuses a buddy link with
    // no trip, a guest link *with* a trip, and a trip that does not exist, and
    // which always dates the link. Two routes that both create invites are two
    // sets of rules to keep in step. Redemption of existing `personal` links
    // is untouched.
    case "revoke-invite": {
      await revokeInvite(username, id);
      return Response.json({ ok: true });
    }
    /**
     * The owner's own row — B619.
     *
     * `/{user}/me` has always had a *your details* form: name, telephone,
     * postal address, the language to write in, the three consents. It is
     * `ContactManage`, gated on the viewer having a contact row, and the
     * owner never had one — so the one reader of that page who could not
     * edit anything about themselves was the person whose journal it is. A
     * postcard could not be addressed to them either: cards go to a
     * `contactId`, and they had none.
     *
     * Three steps, all of them functions that already existed, and no invite
     * mail — which is the whole difference from `create` above. That action
     * mails a link because the owner typed somebody else's address and an
     * address the owner typed is not the address proving it can be read.
     * Here the address is the owner's own and they are signed in as it:
     * `guard` has already checked the session against `owner.email`, so
     * `confirmContactFromSession` is confirming something this request has
     * proved rather than something it is asserting.
     *
     * Idempotent, and deliberately not a rewrite: a row that exists is
     * returned as it stands. Pressing the button twice must not clear the
     * address or the consents already on it — `requestContact`'s
     * existing-row branch would, which is the trap `create` documents beside
     * its own `contact_exists` refusal.
     */
    case "self": {
      const user = getUser(username)!;
      const email = user.owner.email;
      if (!email) {
        // A journal that declares no owner address cannot be written to by
        // anybody (lib/config.ts), so there is no session that could have
        // got here — but the type is optional and a 409 says why rather
        // than throwing.
        return Response.json({ error: "no_owner_email" }, { status: 409 });
      }

      const normalised = normaliseEmail(email);
      const existing = (await listContacts(username)).find((c) => c.email === normalised);
      if (existing) return Response.json({ ok: true, contact: ownerView(existing) });

      const result = await requestContact(username, {
        name: user.owner.nickname || user.owner.name,
        email,
        locale: pickLocale(null, user.defaultLocale),
        // Not `null`: that is "not asked", and this row is being made empty
        // on purpose for the owner to fill in on their own page.
        address: EMPTY_ADDRESS,
        // Every consent starts off. The row exists so there is somewhere to
        // put an address and a number; what it is then used for is the
        // owner's to tick, on the same form everybody else gets.
        wantsEmailDigest: false,
        wantsPostcard: false,
        wantsWhatsapp: false,
        createdVia: "owner-self",
      });
      if (result.outcome === "ignored" || !result.contactId) {
        return Response.json({ error: "blocked_contact" }, { status: 409 });
      }

      const confirmed = await confirmContactFromSession(username, email);
      if (!confirmed.ok) return Response.json({ error: "not_confirmed" }, { status: 409 });
      const approved = await approveContact(username, confirmed.contact.id);
      if (!approved) return Response.json({ error: "not_confirmed" }, { status: 409 });

      return Response.json({ ok: true, contact: ownerView(approved.contact) });
    }
    case "create": {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email : "";
      if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });
      if (!isEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });

      // Refuse rather than silently rewrite: `requestContact`'s existing-row
      // branch overwrites locale and consents, NULLs the postal address, and
      // this route is about to mail a fresh invitation — an owner typing an
      // address they don't realise is already an approved guest would delete
      // that guest's address, unsubscribe them and confuse them with a link
      // they never asked for.
      const normalisedEmail = normaliseEmail(email);
      const already = (await listContacts(username)).some((c) => c.email === normalisedEmail);
      if (already) {
        return Response.json({ error: "contact_exists" }, { status: 409 });
      }

      const address = normaliseAddress(
        typeof body.address === "object" && body.address !== null
          ? (body.address as Record<string, unknown>)
          : null,
      );
      const wantsPostcard = body.wantsPostcard === true;
      if (wantsPostcard && !isPostable(address)) {
        return Response.json({ error: "invalid_address" }, { status: 400 });
      }

      const user = getUser(username)!;
      const locale = pickLocale(
        typeof body.locale === "string" ? body.locale : null,
        null,
        user.defaultLocale,
      );

      // B384 — a bare code mailed straight here had nowhere to be typed: the
      // recipient is not standing in front of the public form the way the
      // guestbook's own reader is, so `confirmedAt` stayed null forever and
      // `approveContact` refused for good (`not_confirmed`, above). The owner
      // typing an address by hand is exactly the case `createInvite` +
      // `sendInviteMail` already exist for — a link the server mails on the
      // owner's behalf rather than one they copy out themselves (B319) —
      // reused here so the same address is pre-approved and one click, in the
      // recipient's own inbox, finishes what the owner started.
      const invite = await createInvite(username, {
        kind: "guest",
        name,
        locale,
        expiresAt: inviteExpiry(),
        email,
      });

      // `pending`, like every other route into this table. The owner typing
      // an address is not the address proving it can be read, and
      // `approveContact` refuses an unconfirmed one for a reason. `createdVia`
      // points at the invite just made, which is what makes the row
      // pre-approved the moment that exact address confirms — see
      // `preapprovedEmailFor`.
      //
      // The address is passed whether or not a postcard was asked for, unlike
      // the public form, which passes it only with the tick. This is the
      // owner's own address book: a number and a street they typed in is
      // something they meant to keep, not a consent they granted themselves.
      const result = await requestContact(username, {
        name,
        email,
        locale,
        address,
        wantsEmailDigest: body.wantsEmailDigest === true,
        wantsPostcard,
        wantsWhatsapp: body.wantsWhatsapp === true,
        createdVia: `invite:${invite.id}`,
      });
      if (result.outcome === "ignored") {
        return Response.json({ error: "blocked_contact" }, { status: 409 });
      }

      // Best effort (B272): the invite and its pre-approval already exist by
      // the time this runs, so a send failure here must not undo either — the
      // row still has `case "resend"` below to try the same link again.
      await sendInviteMail(username, user, {
        email,
        locale,
        kind: "guest",
        url: inviteLinkUrl(serverSite().url, username, "guest", invite.token),
      });

      const contact = await getContact(username, result.contactId);
      return Response.json({ ok: true, contact: contact ? ownerView(contact) : null });
    }
    case "resend": {
      // The button next to a row that is still `pending` and unconfirmed —
      // B384. Reuses the invite `create` above already made rather than
      // minting a second one: same token, same pre-approval, just mailed
      // again for a recipient who has not opened it yet (or lost it).
      const contact = await getContact(username, id);
      if (!contact) return Response.json({ error: "unknown_contact" }, { status: 404 });
      if (contact.confirmedAt) {
        return Response.json({ error: "already_confirmed" }, { status: 409 });
      }
      // B388 — every other action here is gated only by `guard`'s owner
      // check, which is right for something the owner does once; this is the
      // one that mails a stranger's inbox on every call, with the same link
      // every time, so a compromised or scripted session must not be able to
      // loop it. Keyed on the contact rather than the caller's IP: the harm
      // is real mail to one address, not load on this server.
      const limit = rateLimitFor("contact-resend", contact.id, { max: 3, windowMs: 60 * 60 * 1000 });
      if (!limit.ok) {
        return Response.json(
          { error: "too_many_requests", retryAfter: limit.retryAfter },
          { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
        );
      }
      const via = contact.createdVia ?? "";
      if (!via.startsWith("invite:")) {
        return Response.json({ error: "no_invite" }, { status: 409 });
      }
      const invite = (await listInvitesWithLinks(username, serverSite().url)).find(
        (candidate) => candidate.id === via.slice("invite:".length),
      );
      // Revoked, expired, or written before B280 gave links a recoverable
      // token — `resolveInvite` would refuse a redemption of it too, so there
      // is nothing here worth mailing a second time.
      if (!invite || !invite.url) {
        return Response.json({ error: "invite_unavailable" }, { status: 409 });
      }
      const user = getUser(username)!;
      const tripTitle = invite.tripId
        ? (getTrip(tripRef(username, invite.tripId))?.title ?? null)
        : null;
      const sent =
        (await sendInviteMail(username, user, {
          email: contact.email,
          locale: pickLocale(contact.locale, user.defaultLocale),
          kind: invite.kind,
          url: invite.url,
          tripTitle,
        })) !== null;
      return Response.json({ ok: true, sent });
    }
    case "update": {
      // `create` runs the address through `isEmail`; `update` did not, and
      // there is no unique index on `(owner_id, email_key)` to catch what
      // slips through — `requestContact` and `confirmContact` both resolve a
      // contact with `executeTakeFirst()`, so two rows sharing a key make
      // that lookup ambiguous rather than loud. Both checks happen before
      // `updateContactByOwner` is ever called, and neither silently merges.
      if (typeof body.email === "string") {
        if (!isEmail(body.email)) {
          return Response.json({ error: "invalid_email" }, { status: 400 });
        }
        const email = normaliseEmail(body.email);
        const clash = (await listContacts(username)).find(
          (other) => other.id !== id && other.email === email,
        );
        if (clash) return Response.json({ error: "email_taken" }, { status: 409 });
      }

      // The same refusal `create` makes, for the same reason: `update` used
      // to silently zero the tick instead, so the same form gave two
      // different answers to "I want a postcard but gave no address" —
      // wanting one with nowhere to send it is a typo here too.
      const current = await getContact(username, id);
      if (!current) return Response.json({ error: "unknown_contact" }, { status: 404 });
      const currentAddress = current.postalAddress ?? EMPTY_ADDRESS;
      const nextAddress =
        body.address !== undefined
          ? normaliseAddress(body.address as Partial<PostalAddress> | null)
          : currentAddress;
      const nextWantsPostcard =
        typeof body.wantsPostcard === "boolean" ? body.wantsPostcard : current.wantsPostcard;
      // `ContactsAdmin.tsx`'s form always posts a full `wantsPostcard` and
      // `address` on every save, whatever the owner actually touched — so
      // "the request mentions this field" (the previous gate here) is true on
      // every real save, including a name-only edit against a legacy row
      // whose `wants_postcard = 1` sits over an unreadable address. That
      // reintroduced the original bug through the one caller that matters.
      //
      // What must actually be refused is a *change* that leaves the row
      // inconsistent, not the state already sitting in it:
      //  - genuinely turning the preference ON (it was not already on) while
      //    the address on file cannot be posted to, and
      //  - writing an address that now holds *something* but not enough to
      //    post to.
      // A save that re-sends exactly what is already stored — the address
      // unchanged, the tick unchanged — always passes, however unpostable
      // that stored state is; that is what lets an owner fix a name on a
      // pre-fix or key-rotated row at all.
      const addressChanged =
        nextAddress.name !== currentAddress.name ||
        nextAddress.line1 !== currentAddress.line1 ||
        nextAddress.line2 !== currentAddress.line2 ||
        nextAddress.postcode !== currentAddress.postcode ||
        nextAddress.city !== currentAddress.city ||
        nextAddress.country !== currentAddress.country ||
        nextAddress.tel !== currentAddress.tel;
      const turningPostcardOn = nextWantsPostcard && !current.wantsPostcard;
      const newAddressIsHalfWritten =
        addressChanged && hasAnyDetail(nextAddress) && !isPostable(nextAddress);
      if ((turningPostcardOn && !isPostable(nextAddress)) || newAddressIsHalfWritten) {
        return Response.json({ error: "invalid_address" }, { status: 400 });
      }

      const contact = await updateContactByOwner(username, id, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.locale === "string"
          ? { locale: pickLocale(body.locale, null, getUser(username)!.defaultLocale) }
          : {}),
        // Forwarded only when it actually changed, not merely because the
        // form always includes it. `updateContactByOwner` re-encrypts
        // whatever `address` it is given and — deliberately, for a genuine
        // change — zeroes `wants_postcard` itself when that address isn't
        // postable. Forwarding an unchanged address on every save would run
        // that same zeroing against a merely-resent legacy state, silently
        // unsubscribing an owner who only meant to fix a name: the exact
        // "silently zero the tick" failure mode `update` was already fixed
        // not to do, reappearing one layer down.
        ...(addressChanged ? { address: body.address as Partial<PostalAddress> | null } : {}),
        ...(typeof body.wantsEmailDigest === "boolean"
          ? { wantsEmailDigest: body.wantsEmailDigest }
          : {}),
        ...(typeof body.wantsWhatsapp === "boolean"
          ? { wantsWhatsapp: body.wantsWhatsapp }
          : {}),
        ...(typeof body.wantsPostcard === "boolean" && body.wantsPostcard !== current.wantsPostcard
          ? { wantsPostcard: body.wantsPostcard }
          : {}),
      });
      if (!contact) return Response.json({ error: "unknown_contact" }, { status: 404 });
      return Response.json({ ok: true, contact: ownerView(contact) });
    }
    default:
      return Response.json({ error: "unknown_action" }, { status: 400 });
  }
}

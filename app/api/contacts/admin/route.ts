import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import {
  approveContact,
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
import { pickLocale } from "@/lib/contacts/locale";
import { sendApprovedMail, sendInviteMail } from "@/lib/contacts/mail";
import { isOwner } from "@/lib/contacts/session";
import { deviceCountByContact } from "@/lib/push";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
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
function ownerView(contact: ContactRecord, devices: Record<string, number> | null = null) {
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
  return Response.json({
    contacts: (await listContacts(username)).map((contact) => ownerView(contact, devices)),
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
      const contact = await approveContact(username, id);
      // Refused rather than silently ignored: approving an address nobody has
      // proved they can read is how an owner gets talked into leaking a trip.
      if (!contact) return Response.json({ error: "not_confirmed" }, { status: 409 });
      await sendApprovedMail(username, getUser(username)!, contact);
      return Response.json({ ok: true, contact: ownerView(contact) });
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

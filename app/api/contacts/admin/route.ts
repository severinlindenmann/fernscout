import { isEmail, issueCode } from "@/lib/auth";
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
  isPostable,
  normaliseAddress,
  type PostalAddress,
} from "@/lib/contacts/crypto";
import {
  createInvite,
  inviteUrl,
  listInvites,
  openInviteUrl,
  revokeInvite,
} from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { sendApprovedMail, sendCodeMail } from "@/lib/contacts/mail";
import { isOwner } from "@/lib/contacts/session";
import { serverSite } from "@/lib/site";
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
function ownerView(contact: ContactRecord) {
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    locale: contact.locale,
    status: contact.status,
    wantsEmailDigest: contact.wantsEmailDigest,
    wantsPostcard: contact.wantsPostcard,
    hasPostalAddress: contact.hasPostalAddress,
    postalAddress: contact.postalAddress,
    createdVia: contact.createdVia,
    createdAt: contact.createdAt,
    confirmedAt: contact.confirmedAt,
    approvedAt: contact.approvedAt,
    lastSeenAt: contact.lastSeenAt,
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

  return Response.json({
    contacts: (await listContacts(username)).map(ownerView),
    invites: await listInvites(username),
    openLink: openInviteUrl(serverSite().url, username),
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
    case "invite": {
      const invite = await createInvite(username, {
        name: typeof body.name === "string" ? body.name : undefined,
        locale: typeof body.locale === "string" ? body.locale : undefined,
      });
      // Shown once. Only the hash was stored, so a link that is lost has to be
      // reissued rather than looked up.
      return Response.json({
        ok: true,
        id: invite.id,
        url: inviteUrl(serverSite().url, username, invite.token),
      });
    }
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
      // this route mails a fresh code — an owner typing an address they don't
      // realise is already an approved guest would delete that guest's
      // address, unsubscribe them and confuse them with an unexpected code.
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

      // `pending`, like every other route into this table. The owner typing an
      // address is not the address proving it can be read, and approveContact
      // refuses an unconfirmed one for a reason.
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
        createdVia: "owner",
      });
      if (result.outcome === "ignored") {
        return Response.json({ error: "blocked_contact" }, { status: 409 });
      }
      // The same six-digit code the public form sends. Without it the row can
      // never be confirmed and so can never be approved, and an owner-created
      // contact would be a dead end.
      const { code } = await issueCode(username, email, "guest");
      await sendCodeMail(username, user, email, locale, code);

      const contact = await getContact(username, result.contactId);
      return Response.json({ ok: true, contact: contact ? ownerView(contact) : null });
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
      const nextAddress =
        body.address !== undefined
          ? normaliseAddress(body.address as Partial<PostalAddress> | null)
          : (current.postalAddress ?? EMPTY_ADDRESS);
      const nextWantsPostcard =
        typeof body.wantsPostcard === "boolean" ? body.wantsPostcard : current.wantsPostcard;
      // Only refuse when the request actually asserts the postcard preference
      // or touches the address. A row can carry `wants_postcard = 1` with an
      // unreadable address — written by the pre-fix `update`, or a blob that
      // no longer decrypts after a key rotation — and an edit that touches
      // neither must still go through: the owner cannot otherwise correct
      // even the name without first reaching a tick this form may not show.
      const touchesPostcardOrAddress =
        typeof body.wantsPostcard === "boolean" || body.address !== undefined;
      if (touchesPostcardOrAddress && nextWantsPostcard && !isPostable(nextAddress)) {
        return Response.json({ error: "invalid_address" }, { status: 400 });
      }

      const contact = await updateContactByOwner(username, id, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.locale === "string"
          ? { locale: pickLocale(body.locale, null, getUser(username)!.defaultLocale) }
          : {}),
        ...(body.address !== undefined
          ? { address: body.address as Partial<PostalAddress> | null }
          : {}),
        ...(typeof body.wantsEmailDigest === "boolean"
          ? { wantsEmailDigest: body.wantsEmailDigest }
          : {}),
        ...(typeof body.wantsPostcard === "boolean"
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

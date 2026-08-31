import { isEnabled } from "@/lib/capabilities";
import {
  approveContact,
  deleteContact,
  listContacts,
  revokeContact,
  type ContactRecord,
} from "@/lib/contacts";
import {
  createInvite,
  inviteUrl,
  listInvites,
  openInviteUrl,
  revokeInvite,
} from "@/lib/contacts/invites";
import { sendApprovedMail } from "@/lib/contacts/mail";
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
    default:
      return Response.json({ error: "unknown_action" }, { status: 400 });
  }
}

import fs from "node:fs";
import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { findInboxFile } from "@/lib/inbox";
import { createInvite, inviteExpiry, inviteLinkUrl } from "@/lib/contacts/invites";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { unescapeVCardValue } from "@/lib/whatsapp/vcard";

export const dynamic = "force-dynamic";

const LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

/**
 * The deliberate press that replaces what a shared WhatsApp contact card
 * used to do automatically — B1074's successor. The contact has been
 * sitting in the inbox (`handleContactCard`, `lib/whatsapp/dispatch.ts`)
 * since it arrived; this is the only thing that turns it into a guest
 * invite, and it never happens without this press.
 *
 * **An ordinary, unaddressed guest link — never a pre-approved one.**
 * Mints exactly what `app/api/helper/[user]/invite/route.ts` (`invite_guest`)
 * mints: same capability gates, same rate limit, same `inviteExpiry()`, and
 * no `email` in the `createInvite` call. The vCard's own name is used only
 * as the label on the owner's invite list, the same way that sibling route
 * uses whatever name a person types — `createInvite`'s `email` field is what
 * pre-approves an address (`preapprovedEmailFor`, `lib/contacts/invites.ts`),
 * and the vCard's email is a name a stranger chose for themselves, sent over
 * WhatsApp. Passing it through would have let anyone who shares a contact
 * card named "Maria" but carrying their own address get themselves
 * pre-approved guest access the moment the owner pressed "invite Maria" —
 * naming an address is the owner vouching for it (B319), and that is a
 * decision for a page with the address in front of them, never one reached
 * by a model hearing a name over chat. Still checked for a plausible email
 * before proposing anything (`isEmail`), because a card with none is not
 * somebody the owner has any way to reach with the link once it exists —
 * that check is only ever a gate on whether to propose, never an input to
 * `createInvite`.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/invite-contact">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  if (!isEnabled("contacts", user)) {
    refused(user, "invite_contact", "contacts_disabled");
    return Response.json({ error: "contacts_disabled" }, { status: 409 });
  }

  const limited = rateLimitFor("helper-invite", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const id = String(body.contact ?? "").trim();
  const staged = findInboxFile(user, id);
  if (!staged || staged.entry.kind !== "contact") {
    refused(user, "invite_contact", "unknown_contact");
    return Response.json({ error: "unknown_contact" }, { status: 404 });
  }

  const text = fs.readFileSync(staged.file, "utf8");
  // Anchored to a line's start and end (`m`), so a value escaped by
  // `toVCard`'s own `escapeVCardValue` — the only way a real newline gets
  // into this file — can never be read as a second `FN:`/`EMAIL:` line of
  // its own. `unescapeVCardValue` undoes that same escaping on the way out.
  const rawName = /^FN:(.*)$/m.exec(text)?.[1];
  const rawEmail = /^EMAIL:(.*)$/m.exec(text)?.[1];
  const email = rawEmail ? unescapeVCardValue(rawEmail).trim() : undefined;
  if (!email || !isEmail(email)) {
    refused(user, "invite_contact", "no_email");
    return Response.json({ error: "no_email" }, { status: 400 });
  }
  const name = rawName ? unescapeVCardValue(rawName).trim() : undefined;

  // Never `email` here — see the doc comment above. The label only.
  const created = await createInvite(user, {
    kind: "guest",
    tripId: null,
    ...(name ? { name } : {}),
    expiresAt: inviteExpiry(),
  });
  const url = inviteLinkUrl(serverSite().url, user, "guest", created.token);

  // Never the token, and never the email either — an address in the
  // conversation's memory would be a step towards the same claim.
  wrote(user, "invite_contact", { contact: id, ...(name ? { name } : {}) });
  return Response.json({ ok: true, url }, { status: 201 });
}

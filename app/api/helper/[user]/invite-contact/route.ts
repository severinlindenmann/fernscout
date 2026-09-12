import fs from "node:fs";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { findInboxFile } from "@/lib/inbox";
import { createInvite, inviteLinkUrl } from "@/lib/contacts/invites";
import { serverSite } from "@/lib/site";
import { requestLocale } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * The deliberate press that replaces what a shared WhatsApp contact card
 * used to do automatically — B1074's successor. The contact has been
 * sitting in the inbox (`handleContactCard`, `lib/whatsapp/dispatch.ts`)
 * since it arrived; this is the only thing that turns it into a guest
 * invite, and it never happens without this press.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/invite-contact">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
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
  const name = /FN:(.+)/.exec(text)?.[1]?.trim();
  const email = /EMAIL:(.+)/.exec(text)?.[1]?.trim();
  if (!email) {
    refused(user, "invite_contact", "no_email");
    return Response.json({ error: "no_email" }, { status: 400 });
  }

  const locale = await requestLocale();
  const created = await createInvite(user, { kind: "guest", name, locale, email });
  const url = inviteLinkUrl(serverSite().url, user, "guest", created.token);

  wrote(user, "invite_contact", { contact: id, email });
  return Response.json({ ok: true, url }, { status: 201 });
}

import { adminEmail } from "@/lib/admin";
import { isInstanceAdmin } from "@/lib/adminGate";
import { isEmail } from "@/lib/auth";
import { addInvite, listInvites, removeInvite } from "@/lib/inviteList";
import { inviteRequestLocale, sendInviteApprovalMail } from "@/lib/inviteApproval";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The invite list, added to and taken from — B1693.
 *
 * The operator's cookie only, like `/api/admin/acks`: there is no bearer-token
 * path to it, and to anybody who is not the operator this route does not
 * exist. That matters more here than on most admin routes — this list is the
 * whole of who may make a journal on an invite-only instance, so a door into
 * it that an agent token could reach would be a way of inviting yourself.
 *
 * Adding with `notify: true` also mails the address a "You're in" link
 * (`lib/inviteApproval.ts`) and answers `mail`: sent, failed, off or
 * has_journal. The link is the signup-resume link — a signup token on a
 * press, never a cookie — so nothing here can grant more than the entry did.
 *
 * Removing somebody does not touch a journal they already made. An entry is
 * permission to *start*; an existing journal is dealt with on the journals
 * page, where deleting one has always lived.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-invites", clientIp(request), { max: 60, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const bodyRead = await readJsonBody(request);
  if (!bodyRead.ok) return bodyRead.response;
  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const action = body.action === "remove" ? "remove" : "add";
  if (!isEmail(email)) {
    return Response.json(
      { error: "invalid_email", message: "That is not an email address." },
      { status: 400 },
    );
  }

  let mail: Awaited<ReturnType<typeof sendInviteApprovalMail>> | undefined;
  if (action === "remove") {
    await removeInvite(email);
  } else {
    const note = typeof body.note === "string" ? body.note : undefined;
    await addInvite(email, adminEmail() ?? null, note);
    // B-2772. Only when the caller asks (the Invite requests list does, and
    // its "Send again"): typing an address into the list stays silent.
    if (body.notify === true) mail = await sendInviteApprovalMail(email, await inviteRequestLocale(email));
  }
  return Response.json({ ok: true, action, ...(mail ? { mail } : {}), invites: await listInvites() });
}

/** The list, for a client that wants it without a reload. */
export async function GET() {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ invites: await listInvites() });
}

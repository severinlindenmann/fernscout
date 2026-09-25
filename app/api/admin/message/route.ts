import { adminEmail } from "@/lib/admin";
import { isInstanceAdmin } from "@/lib/adminGate";
import { loadUserConfig } from "@/lib/config";
import { mailDisabledReason, sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { USERNAME_RE, userExists } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Long enough for a real note, short enough that nobody pastes a newsletter. */
const MAX_BODY = 4000;
const MAX_SUBJECT = 140;

/**
 * The operator writes to one journal's owner — `/admin`'s "Message owner".
 *
 * **The address never leaves the server.** The page names a journal and this
 * route looks up `owner.email` in that journal's own `config.json`; the
 * operator's browser never receives it, so a screenshot of the panel does not
 * carry anybody's address. The reply goes to the operator, by `Reply-To`.
 *
 * **What happened is what the answer says.** `sendMail` returns null when mail
 * is switched off, on the instance or by the journal's own mail setting, and
 * that is reported as not sent, naming whose setting it was — never as sent.
 * With the file transport a message is written to disk and the answer says
 * that too. It carries the owner's own `features.mail` switch rather than
 * `sendTransactional`'s exemption: an operator's note is a letter, not a code
 * the owner asked for.
 *
 * Cookie-only and 404 to everybody else, the same shape as the other
 * `/api/admin/*` routes. No bearer-token path reaches it.
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-message", clientIp(request), { max: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.user === "string" ? body.user.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!USERNAME_RE.test(username) || !userExists(username)) {
    return Response.json({ error: "no_journal", message: `No journal called "${username}".` }, { status: 404 });
  }
  if (!subject || subject.length > MAX_SUBJECT) {
    return Response.json(
      { error: "subject_required", message: `A subject of 1 to ${MAX_SUBJECT} characters is needed.` },
      { status: 400 },
    );
  }
  if (!text || text.length > MAX_BODY) {
    return Response.json(
      { error: "body_required", message: `A message of 1 to ${MAX_BODY} characters is needed.` },
      { status: 400 },
    );
  }

  const to = loadUserConfig(username).owner.email?.trim() ?? "";
  if (!to) {
    return Response.json(
      { error: "no_address", message: `${username} has no owner address in its config, so there is nowhere to send it.` },
      { status: 409 },
    );
  }

  const blocked = mailDisabledReason(username);
  if (blocked) {
    return Response.json(
      {
        error: "mail_off",
        message:
          blocked === "server"
            ? "Mail is switched off on this instance — /api/health says what it needs. Nothing was sent."
            : `${username} has switched mail off for its journal. Nothing was sent.`,
      },
      { status: 409 },
    );
  }

  const site = serverSite();
  const replyTo = adminEmail();
  const mail = renderMail(
    to,
    subject,
    {
      preheader: text.slice(0, 90),
      title: subject,
      blocks: text.split(/\n{2,}/).map((paragraph) => ({ kind: "paragraph" as const, text: paragraph })),
      footer: `From the operator of ${site.name}, about your journal ${username}. Reply to this mail to answer.`,
    },
    username,
  );
  const result = await sendMail({ ...mail, headers: { ...mail.headers, ...(replyTo ? { "Reply-To": replyTo } : {}) } });
  if (!result) {
    return Response.json({ error: "mail_off", message: "Mail did not go out. Nothing was sent." }, { status: 409 });
  }
  return Response.json({ ok: true, user: username, transport: result.transport });
}

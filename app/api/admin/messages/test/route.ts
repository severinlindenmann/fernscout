import { adminEmail } from "@/lib/admin";
import { isInstanceAdmin } from "@/lib/adminGate";
import { sendMailWith, transportName } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { logMessage } from "@/lib/messages/log";
import { buildPreview, PREVIEW_LOCALES, type PreviewLocale, SAMPLE } from "@/lib/messages/fixtures";
import { TEMPLATES, templateDef, type TemplateId } from "@/lib/messages/registry";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * "Send a test to me" — B2441's Preview panel. Sends the real, rendered mail
 * to the operator's own address (`adminEmail`), through the instance's own
 * configured transport (`transportName`/`sendMailWith`) — the file transport
 * in development, real SMTP wherever that is configured. Logged as its own
 * `status: "test"` row rather than `sendMail`'s ordinary `"sent"`, so a
 * catalogue's 7-day counts and a real send are never confused with each
 * other. **Mail templates only** — B2441 asked for this on the letter
 * preview; SMS/WhatsApp/push cost real money or a real number to test and
 * are out of scope here (say so in the response rather than pretending).
 */
export async function POST(request: Request) {
  if (!(await isInstanceAdmin())) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const limit = rateLimitFor("admin-messages-test", clientIp(request), { max: 10, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const to = adminEmail();
  if (!to) {
    return Response.json({ error: "no_admin_address", message: "FERNSCOUT_ADMIN_EMAIL is not set." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const template = body.template as TemplateId | undefined;
  const locale = (typeof body.locale === "string" ? body.locale : "en") as PreviewLocale;
  if (!template || !(template in TEMPLATES) || templateDef(template).channel !== "mail") {
    return Response.json(
      { error: "invalid_request", message: "template must be a known mail-channel template id." },
      { status: 400 },
    );
  }
  const useLocale = PREVIEW_LOCALES.includes(locale) ? locale : "en";
  const preview = buildPreview(template, useLocale);
  if (preview.channel !== "mail") {
    return Response.json({ error: "invalid_request", message: "Not a mail template." }, { status: 400 });
  }

  const mail = renderMail(to, preview.subject, {
    template,
    preheader: preview.subject,
    title: templateDef(template).kind,
    blocks: [{ kind: "paragraph", text: `Test send from the operator console — sample data (${SAMPLE.journal}).` }],
    why: "This is a test send you asked for from /admin.",
    locale: useLocale,
  });

  const result = await sendMailWith(transportName(), mail);
  await logMessage({ template, channel: "mail", to, status: "test" });

  return Response.json({ ok: true, transport: result.transport });
}

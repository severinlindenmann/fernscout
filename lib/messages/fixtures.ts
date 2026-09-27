import "server-only";
import { translateIn } from "../locales";
import { renderMail } from "../mail/template";
import type { Mail } from "../mail/types";
import { FAMILIES, templateDef, type Channel, type TemplateId } from "./registry";

/**
 * Preview data for admin's Messages panel (B2441) — every template rendered
 * through the real renderer, with obviously-sample data. Nothing here is a
 * real person: `Mara`, `Balkan summer` and `482 913` never reach the send
 * log the way a real name would (`recipient_hash`/`recipient_mask` only).
 *
 * **`code.mail` renders through the exact production call** —
 * `lib/contacts/mail.ts`'s `sendCodeMail` builds it, so this is the one
 * template whose de/hu text is the real, already-shipped translation rather
 * than fixture copy (the acceptance line B2441 names: "Preview of code.mail
 * in de renders German text").
 *
 * Every other template falls back to one generic mail body, translated in
 * en/de/hu (`admin.messages.previewBody`/`previewWhy`) rather than
 * replaying each real call site's own context (a signup flow, a payment, a
 * deletion token) — replicating ~40 call sites for a preview panel is more
 * than this ticket buys, and the ticket's own Work section allows it
 * ("rendering renderMail directly with the template's family why/title/body
 * sample is acceptable"). SMS/WhatsApp/push previews are plain sample text,
 * English only — the real per-channel wording is decided in a later phase
 * (W44's own build order), not this ticket.
 */

export { SAMPLE } from "./previews/sample";
import { SAMPLE } from "./previews/sample";

export type { PreviewLocale } from "./previews/types";
import type { Composition, PreviewLocale } from "./previews/types";
import { accountPreviews } from "./previews/account";
import { digestPreviews } from "./previews/digest";
import { paidPreviews } from "@paid/messages/previews";
export const PREVIEW_LOCALES: PreviewLocale[] = ["en", "de", "hu"];

type MailPreview = { channel: "mail"; subject: string; html: string; text: string };
type TextPreview = { channel: Exclude<Channel, "mail">; title?: string; text: string; freeform?: true };
export type TemplatePreview = MailPreview | TextPreview;

function fill(template: string): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (SAMPLE as Record<string, string>)[k] ?? m);
}

/** The one call site allowed to differ from the generic fallback — see the
 * module comment. Mirrors `sendCodeMail` in lib/contacts/mail.ts exactly,
 * with `to`/`username` fixed to preview values. */
function codeMailPreview(locale: PreviewLocale): Composition {
  const codeText = translateIn(locale, "contact.mailCodeBody", { code: SAMPLE.code, minutes: "15" });
  return {
    channel: "mail",
    subject: translateIn(locale, "contact.mailCodeSubject", { title: SAMPLE.journal }),
    content: {
      template: "code.mail",
      preheader: codeText,
      title: translateIn(locale, "contact.mailCodeTitle"),
      blocks: [
        { kind: "paragraph", text: codeText },
        { kind: "paragraph", text: translateIn(locale, "contact.mailCodeIgnore") },
      ],
      why: translateIn(locale, "mail.why.owner", { site: SAMPLE.journal }),
      locale,
    },
  };
}

function genericMailPreview(id: TemplateId, locale: PreviewLocale): Composition {
  const def = templateDef(id);
  const body = fill(translateIn(locale, "admin.messages.previewBody", { journal: SAMPLE.journal }));
  return {
    channel: "mail",
    subject: def.kind,
    content: {
      template: id,
      preheader: body,
      title: def.kind,
      blocks: [{ kind: "paragraph", text: body }],
      why: translateIn(locale, "admin.messages.previewWhy"),
      locale,
      journalTitle: def.audience === "reader" || def.audience === "owner" ? SAMPLE.journal : undefined,
    },
  };
}

/** One sample line per family, for SMS/WhatsApp/push previews — English
 * only (see module comment). */
const FAMILY_SAMPLE_TEXT: Record<keyof typeof FAMILIES, string> = {
  code: "{code} is your {site} code for {journal}. It works for 15 minutes.",
  invite: "{owner} invited you to read {journal}: fernscout.ch/w/k3x9",
  news: "New on {journal}: {day}",
  nudge: "Still up for telling me about {day}? Just reply here.",
  receipt: "Receipt for a purchase on {journal}.",
  notice: "An account notice about {journal}.",
  operator: "[{site}] an operator alert.",
  chat: "A reply in the WhatsApp conversation about {journal}.",
};

function textPreview(id: TemplateId): TextPreview {
  const def = templateDef(id);
  const text = fill(FAMILY_SAMPLE_TEXT[def.family]);
  if (def.channel === "push") return { channel: "push", title: def.kind, text };
  return { channel: def.channel as Exclude<Channel, "mail">, text };
}

/** Every template's real composer, one file per group (B2493). */
const PREVIEWS = { ...accountPreviews, ...digestPreviews, ...paidPreviews };

/** The template's own composition with sample data — the same call its send
 * site makes. Templates not yet moved over fall back to the generic body. */
export async function composePreview(id: TemplateId, locale: PreviewLocale = "en"): Promise<Composition> {
  const real = PREVIEWS[id];
  if (real) return real(locale);
  const def = templateDef(id);
  if (def.channel !== "mail") return textPreview(id);
  if (id === "code.mail") return codeMailPreview(locale);
  return genericMailPreview(id, locale);
}

export async function buildPreview(id: TemplateId, locale: PreviewLocale = "en"): Promise<TemplatePreview> {
  const c = await composePreview(id, locale);
  if (c.channel !== "mail") return "freeform" in c ? { channel: c.channel, text: c.freeform, freeform: true } : c;
  const mail: Mail = renderMail("preview@example.invalid", c.subject, c.content);
  return { channel: "mail", subject: mail.subject, html: mail.html, text: mail.text };
}

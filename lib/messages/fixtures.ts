import "server-only";
import { renderMail } from "../mail/template";
import type { Mail } from "../mail/types";
import type { Channel, TemplateId } from "./registry";
import type { Composition, PreviewLocale } from "./previews/types";
import { accountPreviews } from "./previews/account";
import { digestPreviews } from "./previews/digest";
import { paidPreviews } from "@paid/messages/previews";

/**
 * Preview data for admin's Messages panel (B2441, B2493). Every template is
 * composed by the same function its send site calls, one map per area
 * (lib/messages/previews/*, paid/messages/previews.ts), with obviously-sample
 * values (`SAMPLE`) — or, for the day letter, a real demo-journal day. There
 * is no generic fallback: `test/message-previews.test.ts` fails for a
 * template without its own composer.
 */

export type { PreviewLocale } from "./previews/types";
export const PREVIEW_LOCALES: PreviewLocale[] = ["en", "de", "hu"];

type MailPreview = { channel: "mail"; subject: string; html: string; text: string };
type TextPreview = { channel: Exclude<Channel, "mail">; title?: string; text: string; freeform?: true };
export type TemplatePreview = MailPreview | TextPreview;

export const PREVIEWS = { ...accountPreviews, ...digestPreviews, ...paidPreviews };

/** The template's own composition with sample data — the same call its send
 * site makes. */
export async function composePreview(id: TemplateId, locale: PreviewLocale = "en"): Promise<Composition> {
  const real = PREVIEWS[id];
  if (!real) throw new Error(`No preview composer for ${id}`);
  return real(locale);
}

export async function buildPreview(id: TemplateId, locale: PreviewLocale = "en"): Promise<TemplatePreview> {
  const c = await composePreview(id, locale);
  if (c.channel !== "mail") return "freeform" in c ? { channel: c.channel, text: c.freeform, freeform: true } : c;
  const mail: Mail = renderMail("preview@example.invalid", c.subject, c.content);
  return { channel: "mail", subject: mail.subject, html: mail.html, text: mail.text };
}

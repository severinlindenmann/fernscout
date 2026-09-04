import type { Mail, MailAttachment } from "./types";

/**
 * The one mail layout.
 *
 * Written for the person most likely to read it: someone in their seventies,
 * on a phone, in a mail client from 2019. That rules out most of what a
 * marketing template does — no columns, no web fonts, no background images, no
 * CSS that only works in one client. Inline styles and a table, because that is
 * what mail clients actually agree on.
 *
 * Every mail has a plain-text alternative built from the same content, so it is
 * never a blank message with an "enable images" prompt.
 */

export type MailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "button"; text: string; href: string }
  | { kind: "item"; title: string; meta?: string; href: string }
  /** A photograph, inline — `cid` names an attachment on the `Mail` this
   * renders into, never a URL. See `lib/mail/types.ts`. */
  | { kind: "image"; cid: string; alt: string }
  /** A line of small type — place, local date, cost — under the title.
   * B345's day-published letter is the first caller. */
  | { kind: "meta"; text: string };

export type MailContent = {
  /** Shown in the inbox preview line, before anyone opens it. */
  preheader: string;
  title: string;
  blocks: MailBlock[];
  /** Small print under the rule: who this is from, how to stop it. */
  footer: string;
  unsubscribeUrl?: string;
  /**
   * The unsubscribe link's label, in the recipient's language.
   *
   * Defaults to English because the transactional letters (a one-time code, a
   * "you're in") are short and their footer is the only line in them a reader
   * skims. The digest passes its own: it is written entirely in the reader's
   * language, and an English "Stop these emails" at the bottom of a Hungarian
   * mail is exactly the seam that makes somebody reach for the spam button
   * instead of the link.
   */
  unsubscribeLabel?: string;
  /**
   * The preferences page (ROADMAP D6), linked from every footer.
   *
   * Separate from `unsubscribeUrl` on purpose — see `unsubscribeUrlFor`. This
   * one takes the reader to their details, where they can change their language
   * or their address instead of leaving altogether.
   */
  manageLink?: { text: string; href: string };
  /** Backing bytes for every `{ kind: "image" }` block above — see
   * `lib/mail/types.ts`. Absent for every letter but the day-published one. */
  attachments?: MailAttachment[];
};

const INK = "#1e293b";
const MUTED = "#475569";
const ACCENT = "#0369a1";
const PAPER = "#fffaf0";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function blockHtml(block: MailBlock): string {
  switch (block.kind) {
    case "heading":
      return `<h2 style="margin:28px 0 8px;font-size:20px;line-height:1.3;color:${INK};font-weight:600">${escapeHtml(block.text)}</h2>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:17px;line-height:1.6;color:${INK}">${escapeHtml(block.text)}</p>`;
    case "button":
      return (
        `<p style="margin:24px 0"><a href="${escapeHtml(block.href)}" ` +
        `style="display:inline-block;padding:14px 24px;background:${INK};color:${PAPER};` +
        `font-size:17px;text-decoration:none;border-radius:10px">${escapeHtml(block.text)}</a></p>`
      );
    case "item":
      return (
        `<p style="margin:0 0 14px;font-size:17px;line-height:1.5">` +
        `<a href="${escapeHtml(block.href)}" style="color:${ACCENT};text-decoration:underline">${escapeHtml(block.title)}</a>` +
        (block.meta ? `<br><span style="color:${MUTED};font-size:15px">${escapeHtml(block.meta)}</span>` : "") +
        `</p>`
      );
    case "image":
      // `cid:` only — never a URL. See MailBlock's own comment.
      return (
        `<p style="margin:0 0 16px"><img src="cid:${escapeHtml(block.cid)}" alt="${escapeHtml(block.alt)}" ` +
        `width="560" style="width:100%;max-width:560px;height:auto;border-radius:12px;display:block"></p>`
      );
    case "meta":
      return `<p style="margin:-8px 0 20px;font-size:14px;line-height:1.5;color:${MUTED}">${escapeHtml(block.text)}</p>`;
  }
}

function blockText(block: MailBlock): string {
  switch (block.kind) {
    case "heading":
      return `\n${block.text}\n${"-".repeat(block.text.length)}`;
    case "paragraph":
      return block.text;
    case "button":
      return `${block.text}: ${block.href}`;
    case "item":
      return `* ${block.title}${block.meta ? ` (${block.meta})` : ""}\n  ${block.href}`;
    // A plain-text reader cannot show the photograph itself; say what it was.
    case "image":
      return `[Photo: ${block.alt}]`;
    case "meta":
      return block.text;
  }
}

export function renderMail(
  to: string,
  subject: string,
  content: MailContent,
  username?: string,
): Mail {
  const html = [
    `<!doctype html><html><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
    `<body style="margin:0;padding:0;background:${PAPER}">`,
    // Hidden preview text: what shows in the inbox list next to the subject.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">`,
    `<tr><td align="center" style="padding:24px 16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;text-align:left;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:${INK};font-weight:700">${escapeHtml(content.title)}</h1>`,
    ...content.blocks.map(blockHtml),
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px">`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:${MUTED}">${escapeHtml(content.footer)}`,
    content.manageLink
      ? `<br><a href="${escapeHtml(content.manageLink.href)}" style="color:${MUTED}">${escapeHtml(content.manageLink.text)}</a>`
      : "",
    content.unsubscribeUrl
      ? `<br><a href="${escapeHtml(content.unsubscribeUrl)}" style="color:${MUTED}">${escapeHtml(content.unsubscribeLabel ?? "Stop these emails")}</a>`
      : "",
    `</p></td></tr></table></td></tr></table></body></html>`,
  ].join("");

  const text = [
    content.title,
    "=".repeat(content.title.length),
    "",
    ...content.blocks.map(blockText),
    "",
    "--",
    content.footer,
    content.manageLink ? `${content.manageLink.text}: ${content.manageLink.href}` : "",
    content.unsubscribeUrl
      ? `${content.unsubscribeLabel ?? "Stop these emails"}: ${content.unsubscribeUrl}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const headers: Record<string, string> = {};
  if (content.unsubscribeUrl) {
    // One-click unsubscribe. Required for bulk mail to stay out of spam, and
    // it is the honest thing to offer anyway.
    headers["List-Unsubscribe"] = `<${content.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    to,
    subject,
    html,
    text,
    headers,
    username,
    ...(content.attachments?.length ? { attachments: content.attachments } : {}),
  };
}

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
  | { kind: "meta"; text: string }
  /**
   * Pre-formatted text, monospaced and scrollable — a journal tail, a stack
   * trace, a command's output. B475's operator alert is the first caller, and
   * it replaces the raw `<pre>` that letter used to build for itself.
   *
   * The plain-text rendering is the text unchanged: it was already laid out
   * for a fixed-width reader, which is the whole reason it is this kind.
   */
  | { kind: "code"; text: string }
  /**
   * A table. `rows` are cells in the order `head` names them, and a row may be
   * followed by a `note` — a line of small type spanning the width, for the
   * facts only some rows have and none deserves a column of its own.
   *
   * In plain text it is padded to a fixed-width grid; in HTML it is a real
   * `<table>`, because padding a proportional font to a monospace grid is what
   * B475 was fixing.
   */
  | { kind: "table"; head: string[]; rows: { cells: string[]; note?: string }[] };

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
/** The tint behind a code block, and the rule under a table row. Two more
 * greys from the same ramp the three below are on — light enough that neither
 * competes with the paper. */
const WASH = "#f6f2e8";
const RULE = "#e2e8f0";
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

/**
 * A scroller that actually scrolls, inside a table cell.
 *
 * `overflow-x:auto` alone does not contain anything here: a `<td>` grows to
 * its content's min-content width, and fixed-width text does not wrap, so a
 * long log line widens the whole letter and the *body* scrolls sideways
 * instead of the block. A single-cell table with `table-layout:fixed` gives
 * the div a definite width to be scrolled within.
 *
 * Contained here rather than by putting `table-layout:fixed` on the letter's
 * own column: five other letters render through that table and none of them
 * needed changing.
 */
function scroller(inner: string, marginBottom: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="table-layout:fixed;margin:0 0 ${marginBottom}"><tr><td style="overflow-x:auto">` +
    inner +
    `</td></tr></table>`
  );
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
    case "code":
      // `overflow-x:auto` because the content is fixed-width by definition and
      // a phone is not: the alternative is a body that scrolls sideways.
      return scroller(
        `<div style="padding:14px 16px;background:${WASH};border-radius:10px">` +
          `<pre style="margin:0;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;` +
          `color:${INK};white-space:pre">${escapeHtml(block.text)}</pre></div>`,
        "16px",
      );
    case "table":
      // Wrapped in its own scroller, for the reason the code block above is:
      // the cells do not wrap (a number split over two lines is not a number),
      // so a table with enough columns is wider than a phone. Without this the
      // whole letter scrolls sideways instead of the table.
      return scroller(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
        `style="border-collapse:collapse;font-size:15px;color:${INK}">` +
        `<tr>${block.head
          .map(
            (head, i) =>
              `<th align="${i === 0 ? "left" : "right"}" style="padding:0 0 6px;border-bottom:1px solid ${RULE};` +
              `font-size:13px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:.04em">` +
              `${escapeHtml(head)}</th>`,
          )
          .join("")}</tr>` +
        block.rows
          .map(
            (row) =>
              `<tr>${row.cells
                .map(
                  (cell, i) =>
                    `<td align="${i === 0 ? "left" : "right"}" style="padding:8px 0 ${row.note ? "2px" : "8px"};` +
                    `border-bottom:${row.note ? "none" : `1px solid ${RULE}`};` +
                    `${i === 0 ? "font-weight:600;" : "font-variant-numeric:tabular-nums;"}white-space:nowrap">` +
                    `${escapeHtml(cell)}</td>`,
                )
                .join("")}</tr>` +
              (row.note
                ? `<tr><td colspan="${row.cells.length}" style="padding:0 0 8px;border-bottom:1px solid ${RULE};` +
                  `font-size:13px;color:${MUTED}">${escapeHtml(row.note)}</td></tr>`
                : ""),
          )
          .join("") +
          `</table>`,
        "20px",
      );
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
    case "code":
      return block.text;
    case "table": {
      // Padded to the widest cell in each column, header included. The same
      // grid `npm run status` prints, arrived at independently — this renderer
      // knows nothing about what is in the table.
      const widths = block.head.map((head, i) =>
        Math.max(head.length, ...block.rows.map((row) => (row.cells[i] ?? "").length)),
      );
      const line = (cells: string[]) =>
        cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
      return [
        line(block.head),
        ...block.rows.flatMap((row) => [
          line(row.cells),
          ...(row.note ? [`${" ".repeat(widths[0])}  ${row.note}`] : []),
        ]),
      ].join("\n");
    }
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

import "server-only";
import { translateIn } from "../locales";
import { templateDef, type TemplateId } from "../messages/registry";
import { serverSite } from "../site";
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
  /** Which registry id this is — B2438. Required so every `renderMail` call
   * names one; `test/message-registry.test.ts` is what catches an id that
   * has drifted out of lib/messages/registry.ts. */
  template: TemplateId;
  /** Shown in the inbox preview line, before anyone opens it. */
  preheader: string;
  title: string;
  blocks: MailBlock[];
  /**
   * The recipient's language — B2440. Used for exactly one thing this module
   * decides on its own: the "Why you got this:" label ahead of `why`. Every
   * other word in the letter is already in this language by the time it
   * reaches here; a caller that resolved no locale at all gets English.
   */
  locale?: string;
  /**
   * The journal this letter is about, for the header's right-hand word —
   * reader mail (an invite, a day letter) names the journal; account mail
   * (a sign-in code, a receipt) names the site instead, so this is left out
   * for those.
   */
  journalTitle?: string;
  /**
   * One sentence answering "why did I get this" — required, and rendered as
   * **"Why you got this:"** (localized) followed by this text. Was `footer`
   * before B2440; the wording at most call sites needed no change; only the
   * label ahead of it and its family-gated presence did.
   */
  why: string;
  /**
   * The line under `why` for changing or stopping this stream — absent for
   * `code` family mail, which never carries one (W44's letter table). Also
   * what puts a `List-Unsubscribe` header on the message: the two travel
   * together, since a mail with a visible stop line the header disagrees
   * with is the one-click compliance gap the header exists to close.
   *
   * `href` is the visible footer link — a page a person reads before doing
   * anything. `unsubscribeHref` (security review M2), when different, is
   * what the `List-Unsubscribe` header and its One-Click POST actually hit;
   * it defaults to `href` when absent. The two differ for `invite.mail`:
   * its footer points at `/x/<token>` (`app/x/[token]/page.tsx`, GET only —
   * a page describing what pressing the button does), and only
   * `/x/<token>/confirm` (its own segment; Next refuses a route and a page
   * sharing one) answers the POST a mail client's own one-click button
   * sends. Pointing `List-Unsubscribe` at the page meant that POST landed on
   * a route with no handler for it and suppressed nothing.
   */
  manage?: { text: string; href: string; unsubscribeHref?: string };
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
/** The header's dot — the brand yellow, W44 D8. */
const ACCENT_YELLOW = "#ffd23f";

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
  const locale = content.locale ?? "en";
  const site = serverSite();
  // Code mail never carries a manage link or a List-Unsubscribe header — a
  // family rule enforced here rather than trusted from every call site (W44
  // "The letter"): a code mail whose recipient has not confirmed anything
  // yet has nothing to be unsubscribed from.
  const family = templateDef(content.template).family;
  const manage = family === "code" ? undefined : content.manage;
  const whyLabel = translateIn(locale, "mail.whyLabel");

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
    // The header — text wordmark and a yellow dot, drawn in HTML (a `<span>`
    // with a background colour and border-radius). No `<img>`, no SVG:
    // images are blocked by default in Outlook and neither client renders an
    // inline SVG (W44 D8). On the right, the journal this letter is about,
    // or the site itself for account mail with no journal to name.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">` +
      `<tr><td style="font-size:14px;font-weight:700;color:${INK}">` +
      `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${ACCENT_YELLOW};` +
      `margin-right:8px;vertical-align:middle"></span>${escapeHtml(site.name)}</td>` +
      `<td align="right" style="font-size:13px;color:${MUTED}">${escapeHtml(content.journalTitle ?? site.name)}</td>` +
      `</tr></table>`,
    `<h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:${INK};font-weight:700">${escapeHtml(content.title)}</h1>`,
    ...content.blocks.map(blockHtml),
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px">`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:${MUTED}">` +
      `<strong>${escapeHtml(whyLabel)}</strong> ${escapeHtml(content.why)}`,
    manage ? `<br><a href="${escapeHtml(manage.href)}" style="color:${MUTED}">${escapeHtml(manage.text)}</a>` : "",
    `</p></td></tr></table></td></tr></table></body></html>`,
  ].join("");

  const text = [
    content.title,
    "=".repeat(content.title.length),
    "",
    ...content.blocks.map(blockText),
    "",
    "--",
    `${whyLabel} ${content.why}`,
    manage ? `${manage.text}: ${manage.href}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const headers: Record<string, string> = {};
  if (manage) {
    // One-click unsubscribe. Required for bulk mail to stay out of spam, and
    // it is the honest thing to offer anyway — never for code mail (gated
    // above, with `manage`). The POST target (M2): `unsubscribeHref` when
    // the caller named one, since a page-only footer link cannot answer it.
    headers["List-Unsubscribe"] = `<${manage.unsubscribeHref ?? manage.href}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    to,
    subject,
    template: content.template,
    html,
    text,
    headers,
    username,
    ...(content.attachments?.length ? { attachments: content.attachments } : {}),
  };
}

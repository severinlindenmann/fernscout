import { Mail } from "./types";

/**
 * A multipart/alternative RFC 822 message.
 *
 * Written by hand rather than pulled from a library because the file transport
 * needs a real `.eml` a mail client will open, and that is a small, stable
 * format. Anything more elaborate belongs to a real SMTP client.
 */

/** RFC 2047 encoding, so a subject with an umlaut survives the wire. */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function foldBase64(input: string): string {
  return (input.match(/.{1,76}/g) ?? []).join("\r\n");
}

function newBoundary(): string {
  return `fs-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** The text and HTML parts, as a `multipart/alternative` body — unchanged
 * from before attachments existed. */
function alternativeBody(mail: Mail, boundary: string): string {
  return [
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(mail.text, "utf8").toString("base64")),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(mail.html, "utf8").toString("base64")),
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

export function buildMessage(mail: Mail, from: string, date = new Date()): string {
  const attachments = mail.attachments ?? [];
  const altBoundary = newBoundary();
  const headers: Record<string, string> = {
    From: from,
    To: mail.to,
    Subject: encodeHeader(mail.subject),
    Date: date.toUTCString(),
    "MIME-Version": "1.0",
    ...mail.headers,
  };

  let contentType: string;
  let body: string;

  if (attachments.length === 0) {
    // The shape every letter but the day-published one has always had.
    contentType = `multipart/alternative; boundary="${altBoundary}"`;
    body = alternativeBody(mail, altBoundary) + "\r\n";
  } else {
    /*
     * `multipart/related` wrapping the text/html alternative, with one part
     * per inline image — the standard shape for a `cid:` reference (RFC
     * 2387). The alternative stays nested rather than flattened so a client
     * that does not understand `related` at all still finds a normal
     * text-or-html choice inside it.
     *
     * **Unless something is attached rather than inline** (B467). `related`
     * asserts that every part is a piece of one document, which is true of a
     * photograph the HTML shows by `cid:` and false of a PDF receipt the
     * reader saves — a client honouring `related` may not offer it at all.
     * One attached part makes the whole message `multipart/mixed`, which is
     * the envelope that means "a message, plus files".
     */
    const relBoundary = newBoundary();
    const mixed = attachments.some((a) => a.disposition === "attachment");
    contentType = `multipart/${mixed ? "mixed" : "related"}; boundary="${relBoundary}"`;
    const parts = [
      "",
      `--${relBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      alternativeBody(mail, altBoundary),
      "",
    ];
    for (const attachment of attachments) {
      parts.push(
        `--${relBoundary}`,
        `Content-Type: ${attachment.contentType}`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${attachment.contentId}>`,
        `Content-Disposition: ${attachment.disposition ?? "inline"}; filename="${attachment.filename}"`,
        "",
        foldBase64(attachment.data.toString("base64")),
        "",
      );
    }
    parts.push(`--${relBoundary}--`, "");
    body = parts.join("\r\n");
  }

  headers["Content-Type"] = contentType;
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");

  return head + "\r\n" + body;
}

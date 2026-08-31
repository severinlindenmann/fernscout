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

export function buildMessage(mail: Mail, from: string, date = new Date()): string {
  const boundary = `fs-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const headers: Record<string, string> = {
    From: from,
    To: mail.to,
    Subject: encodeHeader(mail.subject),
    Date: date.toUTCString(),
    "MIME-Version": "1.0",
    "Content-Type": `multipart/alternative; boundary="${boundary}"`,
    ...mail.headers,
  };

  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");

  // Base64 for both parts: it survives any transport without worrying about
  // line length, trailing whitespace or non-ASCII.
  const body = [
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
    "",
  ].join("\r\n");

  return head + "\r\n" + body;
}

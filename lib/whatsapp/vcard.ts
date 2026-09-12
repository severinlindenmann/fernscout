/**
 * RFC 6350 §3.4's own escaping — a backslash before `\`, `,` and `;`, and a
 * real newline written as the two characters `\n`. A WhatsApp contact's own
 * name arrives attacker-controlled (anyone can share a "contact" with the
 * business number) and a JSON message body can carry a literal newline in a
 * string field, so without this a crafted name could inject a second
 * `EMAIL:` line — the vCard's own field separator is a real newline, and
 * that is exactly what this closes off. `unescapeVCardValue` below is its
 * exact inverse, used only by this file's own reader
 * (`app/api/helper/[user]/invite-contact/route.ts`), so the pair only has
 * to agree with each other and never has to be a full vCard parser.
 */
function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * The inverse of `escapeVCardValue`, for the one reader that parses a
 * staged card back out. A single backslash-plus-one-character regex is
 * enough (and, unlike a sequence of separate global replaces, correct):
 * `escapeVCardValue` only ever emits a backslash immediately followed by
 * one of `\`, `n`, `,` or `;`, so scanning left to right and consuming two
 * characters at a time never re-reads a character an earlier replace has
 * already produced.
 */
export function unescapeVCardValue(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
}

/**
 * A shared WhatsApp contact, restated as a minimal vCard — B1074's
 * successor. Nothing here is invented: every line is a field the message
 * already carried (`lib/whatsapp/inbound.ts`'s own `contacts` parsing),
 * restructured into the standard format `storeInboxFile` can hold as
 * ordinary bytes.
 */
export function toVCard(contact: { name?: string; phones?: string[]; emails?: string[] }): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.name) lines.push(`FN:${escapeVCardValue(contact.name)}`);
  for (const phone of contact.phones ?? []) lines.push(`TEL:${escapeVCardValue(phone)}`);
  for (const email of contact.emails ?? []) lines.push(`EMAIL:${escapeVCardValue(email)}`);
  lines.push("END:VCARD");
  return lines.join("\n") + "\n";
}

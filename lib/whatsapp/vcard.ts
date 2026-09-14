/**
 * RFC 6350 §3.4's own escaping — a backslash before `\`, `,` and `;`, and a
 * real newline written as the two characters `\n`. A WhatsApp contact's own
 * name arrives attacker-controlled (anyone can share a "contact" with the
 * business number) and a JSON message body can carry a literal newline in a
 * string field, so without this a crafted name could inject a second
 * `EMAIL:` line — the vCard's own field separator is a real newline, and
 * that is exactly what this closes off. `unescapeVCardValue` below is its
 * exact inverse, used only by this file's own reader
 * (`readVCard`, below), so the pair only has to agree with each other and
 * never has to be a full vCard parser.
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
 * staged card back out — `readVCard` at the foot of this file since B1737,
 * where the two regexes that used to live in
 * `app/api/helper/[user]/invite-contact/route.ts` now sit beside the escaping
 * they undo. A single backslash-plus-one-character regex is
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

/**
 * The two fields a staged card is ever read for — B1737.
 *
 * Lifted out of `app/api/helper/[user]/invite-contact/route.ts`, which wrote
 * these two regexes inline and was the only reader until `trip_people` needed
 * the same answer. Two call sites deriving an email from the same bytes
 * separately is how they come to disagree about one card.
 *
 * Anchored to a line's start and end (`m`), so a value escaped by
 * `escapeVCardValue` above — the only way a real newline reaches this file —
 * can never be read as a second `FN:`/`EMAIL:` line of its own.
 */
export function readVCard(text: string): { name?: string; email?: string } {
  const rawName = /^FN:(.*)$/m.exec(text)?.[1];
  const rawEmail = /^EMAIL:(.*)$/m.exec(text)?.[1];
  const name = rawName ? unescapeVCardValue(rawName).trim() : "";
  const email = rawEmail ? unescapeVCardValue(rawEmail).trim() : "";
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

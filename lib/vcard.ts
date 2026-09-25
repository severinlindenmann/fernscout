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
/** @public open core: paid/ uses this (tagged by open-core/split). */
export function unescapeVCardValue(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
}

/**
 * A shared WhatsApp contact, restated as a minimal vCard — B1074's
 * successor. Nothing here is invented: every line is a field the message
 * already carried (`paid/whatsapp/lib/whatsapp/inbound.ts`'s own `contacts` parsing),
 * restructured into the standard format `storeInboxFile` can hold as
 * ordinary bytes.
 */
export function toVCard(contact: {
  name?: string;
  phones?: string[];
  emails?: string[];
  addresses?: Array<{ street?: string; city?: string; state?: string; zip?: string; country?: string }>;
}): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.name) lines.push(`FN:${escapeVCardValue(contact.name)}`);
  for (const phone of contact.phones ?? []) lines.push(`TEL:${escapeVCardValue(phone)}`);
  for (const email of contact.emails ?? []) lines.push(`EMAIL:${escapeVCardValue(email)}`);
  // RFC 6350 §6.3.1's seven semicolon-separated components: post-office-box,
  // extended, street, locality, region, postal-code, country. Meta's message
  // only ever fills street/city/state/zip/country, so post-office-box and
  // extended are always empty here. Each component goes through
  // `escapeVCardValue` (which escapes a literal `;` inside a value) and the
  // seven results are joined with a *literal*, unescaped `;` — that is the
  // structural separator RFC 6350 itself defines, not a value to protect.
  for (const a of contact.addresses ?? []) {
    const components = ["", "", a.street ?? "", a.city ?? "", a.state ?? "", a.zip ?? "", a.country ?? ""];
    lines.push(`ADR:${components.map(escapeVCardValue).join(";")}`);
  }
  lines.push("END:VCARD");
  return lines.join("\n") + "\n";
}

/**
 * The fields a staged card is ever read for — B1737, counts added by B1995
 * so an inbox tile can say "3 Telefonnummern · 1 E-Mail" without a second
 * reader growing its own regexes.
 *
 * Lifted out of `app/api/helper/[user]/invite-contact/route.ts`, which wrote
 * these two regexes inline and was the only reader until `trip_people` needed
 * the same answer. Two call sites deriving an email from the same bytes
 * separately is how they come to disagree about one card.
 *
 * Anchored to a line's start and end (`m`), so a value escaped by
 * `escapeVCardValue` above — the only way a real newline reaches this file —
 * can never be read as a second `FN:`/`EMAIL:`/`TEL:` line of its own. `email`
 * stays the *first* address, exactly as before (`invite-contact`'s own use);
 * `emails` is every one of them, for the count.
 */
export function readVCard(text: string): { name?: string; email?: string; phones: number; emails: number } {
  const rawName = /^FN:(.*)$/m.exec(text)?.[1];
  const rawEmail = /^EMAIL:(.*)$/m.exec(text)?.[1];
  const name = rawName ? unescapeVCardValue(rawName).trim() : "";
  const email = rawEmail ? unescapeVCardValue(rawEmail).trim() : "";
  const phones = text.match(/^TEL:.*$/gm)?.length ?? 0;
  const emails = text.match(/^EMAIL:.*$/gm)?.length ?? 0;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), phones, emails };
}

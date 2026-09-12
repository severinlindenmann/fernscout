/**
 * A shared WhatsApp contact, restated as a minimal vCard — B1074's
 * successor. Nothing here is invented: every line is a field the message
 * already carried (`lib/whatsapp/inbound.ts`'s own `contacts` parsing),
 * restructured into the standard format `storeInboxFile` can hold as
 * ordinary bytes.
 */
export function toVCard(contact: { name?: string; phones?: string[]; emails?: string[] }): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.name) lines.push(`FN:${contact.name}`);
  for (const phone of contact.phones ?? []) lines.push(`TEL:${phone}`);
  for (const email of contact.emails ?? []) lines.push(`EMAIL:${email}`);
  lines.push("END:VCARD");
  return lines.join("\n") + "\n";
}

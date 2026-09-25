import { isSaneContact, type ContactsImporter, type ParsedContact } from "./schema";

/**
 * A vCard — what a phone's own contacts app shares, in the format every
 * address book on every platform has written since vCard 3.0 — B1394.
 *
 * Deliberately small: `FN` (or `N`, joined), the first `EMAIL`, the first
 * `TEL`. A vCard can carry a photograph, a birthday, a dozen addresses and a
 * company name; none of that is read, because none of it is what this
 * importer exists to move — a person picking who, of everybody on their
 * phone, has actually asked this journal for post.
 */

/** Unfold continuation lines — RFC 6350 §3.2: a line starting with a single
 *  space or tab is the previous line, wrapped. Most exports are one property
 *  per line and never trigger this, but a card with a long `PHOTO` or `NOTE`
 *  does, and an unfolded `EMAIL` split mid-address parses as nothing. */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** `EMAIL;TYPE=INTERNET,HOME:anna@example.com` → `{ name: "EMAIL", value:
 *  "anna@example.com" }`. Parameters are read for nothing here — TYPE, PREF,
 *  an encoding — because this importer takes the first of each field, not
 *  the "best" one, so there is nothing to decide from them. */
function splitLine(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const name = left.split(";")[0]?.trim().toUpperCase();
  if (!name) return null;
  return { name, value: line.slice(colon + 1).trim() };
}

/** `N:Muster;Anna;;;` → "Anna Muster" — family, then given, the order most
 *  address books show, skipping the additional/prefix/suffix components
 *  nothing here reads. */
function nameFromN(value: string): string {
  const [family, given] = value.split(";").map((part) => part.trim());
  return [given, family].filter(Boolean).join(" ");
}

function parseCard(lines: string[]): ParsedContact | null {
  let fn = "";
  let n = "";
  let email: string | undefined;
  let tel: string | undefined;
  for (const raw of lines) {
    const field = splitLine(raw);
    if (!field || !field.value) continue;
    if (field.name === "FN" && !fn) fn = field.value;
    else if (field.name === "N" && !n) n = nameFromN(field.value);
    else if (field.name === "EMAIL" && !email) email = field.value.toLowerCase();
    else if (field.name === "TEL" && !tel) tel = field.value;
  }
  // Never invented: a name is read from FN or N, or — with neither — the
  // one other thing on the card that can stand in for a label.
  const name = fn || n || email || tel || "";
  if (!name) return null;
  return { name, email, tel };
}

const importer: ContactsImporter = {
  id: "vcard",
  label: "vCard (.vcf), a phone's own address book",

  detect(head, filename) {
    return /\.vcf$/i.test(filename) || /^BEGIN:VCARD/im.test(head);
  },

  parse(text) {
    const lines = unfold(text);
    const out: ParsedContact[] = [];
    let card: string[] | null = null;
    for (const line of lines) {
      const upper = line.trim().toUpperCase();
      if (upper === "BEGIN:VCARD") {
        card = [];
        continue;
      }
      if (upper === "END:VCARD") {
        if (card) {
          const parsed = parseCard(card);
          // Skip what does not parse rather than throwing — one malformed
          // card in an export of twenty must not cost the other nineteen.
          if (parsed && isSaneContact(parsed)) out.push(parsed);
        }
        card = null;
        continue;
      }
      if (card) card.push(line);
    }

    if (out.length === 0 && !/BEGIN:VCARD/i.test(text)) throw new Error("not a vCard file");
    return out;
  },
};

export default importer;

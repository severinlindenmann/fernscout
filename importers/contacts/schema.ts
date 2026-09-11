/**
 * People — the row type for every importer in this folder.
 *
 * The generic shape is one level up in `../schema.ts`; what is here is only
 * what a **phone's own address book** needs. A row is what a vCard **is**,
 * not what a journal's contact is: a name, and whatever it happened to carry
 * beside it.
 *
 * **There is deliberately no `wantsPostcard` or `status` here.** A vCard is
 * somebody's own address book, most of whom have never asked this journal
 * for anything — B1394's whole point, the same as `costs/`'s Payment
 * carrying no category: an importer reads and reports, and a person decides
 * which rows actually become a contact, one at a time, on the same form
 * everybody else's request goes through (`lib/contacts/index.ts`,
 * `requestContact`). Nothing here writes.
 */
import type { Importer } from "../schema";

export type ParsedContact = {
  /** From `FN`, or the structured `N` fields joined, or — when neither vCard
   *  field is present — the first email or phone number, because a picker
   *  with no label at all cannot be ticked meaningfully. Never invented. */
  name: string;
  /**
   * The first `EMAIL`, lower-cased. Absent for a phone contact with a number
   * and nothing else — common enough on a phone that it is worth keeping the
   * row rather than dropping it, but a row with no email cannot become a
   * contact: `lib/contacts` keys every row on one.
   */
  email?: string;
  /** The first `TEL`, exactly as the card wrote it — no reformatting, so
   *  what is shown is what was actually in the file. */
  tel?: string;
};

export type ContactsImporter = Importer<ParsedContact>;

/** A row that could be a real parsed contact — a name, and nothing that
 *  looks like it was invented rather than read. */
export function isSaneContact(row: ParsedContact): boolean {
  return typeof row.name === "string" && row.name.trim().length > 0;
}

/**
 * **Run this against your own importer.** Same contract as `gps/` and
 * `costs/`: bring the row above, call this, fix what it lists.
 */
export function checkContactsImporter(importer: ContactsImporter, rows: ParsedContact[]): string[] {
  const problems: string[] = [];
  const say = (problem: string) => problems.push(problem);

  if (!/^[a-z0-9-]+$/.test(importer.id))
    say(`id ${JSON.stringify(importer.id)} must be lowercase letters, digits and dashes`);
  if (!importer.label) say("label is empty — it is what the caller lists");

  if (rows.length === 0) {
    say(
      "parse returned nothing. Either this is the wrong importer for the file, or the " +
        "card holds no entries — or every entry was skipped as unreadable, which is what " +
        "happens when a vCard has no FN, N or usable EMAIL/TEL",
    );
    return problems;
  }

  const unnamed = rows.filter((r) => !r.name || !r.name.trim());
  if (unnamed.length > 0)
    say(
      `${unnamed.length} of ${rows.length} rows have no name at all — every entry needs one ` +
        "to be shown, even when it is only the email or the number that was read",
    );

  const badEmail = rows.filter((r) => r.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
  if (badEmail.length > 0)
    say(
      `${badEmail.length} rows carry an \`email\` that is not one — first: ` +
        `${JSON.stringify(badEmail[0].email)}. Leave the field off rather than passing ` +
        "through something that is not an address",
    );

  return problems;
}

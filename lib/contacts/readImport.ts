import "server-only";
import { CONTACTS_IMPORTERS } from "@/importers/contacts";
import { checkContactsImporter, type ContactsImporter, type ParsedContact } from "@/importers/contacts/schema";

/**
 * Reading a phone's own address book, and what happens to what comes out —
 * B1394, the same shape `lib/statements/read.ts` gave a bank statement.
 *
 * **The import reads and reports; nothing here writes a contact.** A vCard
 * carries other people's names and, sometimes, a postal address — exactly
 * the thing an agent must never decide belongs in this journal (AGENTS.md).
 * So this hands back what was parsed, and a person ticks who is actually a
 * contact; only `requestContact`, called with rows a person agreed to, ever
 * writes a row — the same `pending` state and the same confirmation mail
 * every other contact gets.
 */

export type ContactsOutcome = {
  kind: "contacts";
  format: string;
  detected: boolean;
  /** Every row that parsed, named and shown — this is what a person ticks
   *  from, so unlike a costs statement's model-facing report, the whole list
   *  travels here. Nothing calls this from a conversational tool; see
   *  B1394's own note on why that is what keeps a name out of the model's
   *  own view of an import. */
  people: ParsedContact[];
  /** How many of `people` carry an email — the one thing a row can become a
   *  contact without: `lib/contacts` keys every row on one, so a phone
   *  contact with a number only is shown but cannot be agreed. */
  withEmail: number;
};

export type ContactsRefusal = {
  refusal: "unknown_format" | "unreadable" | "contract";
  message: string;
  problems?: string[];
};

function subject(filename: string): string {
  return filename === "inline" ? "the text you sent" : JSON.stringify(filename);
}

const HEAD_CHARS = 64 * 1024;

function chooseImporter(
  text: string,
  filename: string,
  format: string | undefined,
): { importer: ContactsImporter; detected: boolean } | ContactsRefusal {
  if (format !== undefined) {
    const named = CONTACTS_IMPORTERS.find((i) => i.id === format);
    if (!named)
      return {
        refusal: "unknown_format",
        message:
          `No contacts importer called ${JSON.stringify(format)}. Known formats: ` +
          `${CONTACTS_IMPORTERS.map((i) => i.id).join(", ")}. Leave \`format\` out and the ` +
          "file is recognised from its own contents.",
      };
    return { importer: named, detected: false };
  }
  const found = CONTACTS_IMPORTERS.find((i) => i.detect(text.slice(0, HEAD_CHARS), filename));
  if (!found)
    return {
      refusal: "unknown_format",
      message:
        `Nothing recognised ${subject(filename)} as an address book export. Known formats: ` +
        `${CONTACTS_IMPORTERS.map((i) => i.id).join(", ")}.`,
    };
  return { importer: found, detected: true };
}

export function readContactsFile(
  text: string,
  filename: string,
  options: { format?: string } = {},
): ContactsOutcome | ContactsRefusal {
  const chosen = chooseImporter(text, filename, options.format);
  if ("refusal" in chosen) return chosen;

  let rows: ParsedContact[];
  try {
    rows = chosen.importer.parse(text);
  } catch (error) {
    return {
      refusal: "unreadable",
      message:
        `${chosen.importer.id} could not read ${subject(filename)}: ` +
        `${(error as Error).message}. ` +
        (chosen.detected
          ? "It was chosen by looking at the file, so it may be the wrong one — name a format."
          : "It was the format you named; check that against the file."),
    };
  }

  const problems = checkContactsImporter(chosen.importer, rows);
  if (problems.length > 0)
    return {
      refusal: "contract",
      message: `${chosen.importer.id} read the file, and what came out does not hold up.`,
      problems,
    };

  return {
    kind: "contacts",
    format: chosen.importer.id,
    detected: chosen.detected,
    people: rows,
    withEmail: rows.filter((r) => r.email).length,
  };
}

import { describe, expect, test } from "vitest";
import { checkContactsImporter } from "@/importers/contacts/schema";
import { CONTACTS_IMPORTERS } from "@/importers/contacts";
import vcard from "@/importers/contacts/vcard";
import { readContactsFile } from "@/lib/contacts/readImport";

/**
 * B1394 — a phone's own contacts, read and reported, never written by
 * themselves. See `importers/README.md`: a new kind is a folder with its
 * own row type and its own check; this is `contacts/`'s.
 */

const ONE = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Anna Muster",
  "N:Muster;Anna;;;",
  "EMAIL;TYPE=INTERNET:Anna.Muster@Example.com",
  "TEL;TYPE=CELL:+41 79 123 45 67",
  "END:VCARD",
].join("\r\n");

describe("vcard", () => {
  test("reads a name, a lower-cased email, and a phone number", () => {
    const out = vcard.parse(ONE);
    expect(out).toEqual([
      { name: "Anna Muster", email: "anna.muster@example.com", tel: "+41 79 123 45 67" },
    ]);
  });

  test("recognises itself by extension or by its own BEGIN line", () => {
    expect(vcard.detect(ONE, "contacts.vcf")).toBe(true);
    expect(vcard.detect(ONE, "export.txt")).toBe(true);
    expect(vcard.detect("name,email\na,b", "sheet.csv")).toBe(false);
  });

  test("several cards in one file, one skipped for having no name at all", () => {
    const file = [
      ONE,
      "BEGIN:VCARD",
      "VERSION:3.0",
      "TEL:+41 79 000 00 00",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Bo",
      "END:VCARD",
    ].join("\r\n");
    const out = vcard.parse(file);
    // Anna (FN+EMAIL+TEL), the phone-only row (name falls back to the tel),
    // and Bo (FN only, no email) — the wholly empty card is dropped.
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ name: "+41 79 000 00 00", tel: "+41 79 000 00 00" });
    expect(out[2]).toEqual({ name: "Bo" });
  });

  test("a name is never invented for a card with neither FN, N, EMAIL nor TEL", () => {
    const file = ["BEGIN:VCARD", "VERSION:3.0", "NOTE:just a note", "END:VCARD"].join("\r\n");
    expect(vcard.parse(file)).toEqual([]);
  });

  test("a folded (wrapped) line is read as one field", () => {
    const file = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Anna Muster",
      "NOTE:a very long note that wraps onto a",
      " continuation line, per RFC 6350",
      "EMAIL:anna@example.com",
      "END:VCARD",
    ].join("\r\n");
    expect(vcard.parse(file)[0]).toEqual({ name: "Anna Muster", email: "anna@example.com" });
  });

  test("throws only when the file is not a vCard at all", () => {
    expect(() => vcard.parse("id,name\n1,a\n")).toThrow();
  });
});

describe("checkContactsImporter", () => {
  test("the shipped importer holds up against its own fixture", () => {
    expect(checkContactsImporter(vcard, vcard.parse(ONE))).toEqual([]);
  });

  test("names what is wrong", () => {
    expect(checkContactsImporter(vcard, []).join(" ")).toMatch(/returned nothing/);
    expect(
      checkContactsImporter(vcard, [{ name: "A", email: "not-an-email" }]).join(" "),
    ).toMatch(/not one/);
  });
});

describe("the folder and the list", () => {
  test("every listed importer holds up the contract", () => {
    for (const importer of CONTACTS_IMPORTERS) {
      expect(importer.id).toMatch(/^[a-z0-9-]+$/);
      expect(importer.label.length).toBeGreaterThan(0);
    }
  });
});

describe("readContactsFile", () => {
  test("a clean read reports people and how many carry an email", () => {
    const outcome = readContactsFile(ONE, "contacts.vcf");
    expect("refusal" in outcome).toBe(false);
    if ("refusal" in outcome) return;
    expect(outcome.people).toHaveLength(1);
    expect(outcome.withEmail).toBe(1);
    expect(outcome.format).toBe("vcard");
  });

  test("nothing recognised is a refusal, not a throw", () => {
    const outcome = readContactsFile("id,name\n1,a\n", "budget.csv");
    expect("refusal" in outcome && outcome.refusal).toBe("unknown_format");
  });
});

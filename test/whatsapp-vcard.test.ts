import { describe, expect, test } from "vitest";
import { toVCard, unescapeVCardValue } from "@/lib/whatsapp/vcard";

describe("toVCard", () => {
  test("a name, a phone and an email become a minimal vCard", () => {
    const text = toVCard({ name: "Maria", phones: ["+41791234567"], emails: ["maria@example.test"] });
    expect(text).toContain("BEGIN:VCARD");
    expect(text).toContain("FN:Maria");
    expect(text).toContain("TEL:+41791234567");
    expect(text).toContain("EMAIL:maria@example.test");
    expect(text).toContain("END:VCARD");
  });

  test("nothing given is still a well-formed, empty card", () => {
    const text = toVCard({});
    expect(text).toContain("BEGIN:VCARD");
    expect(text).toContain("END:VCARD");
  });

  test("a name carrying a raw newline cannot inject a second EMAIL: line", () => {
    // What a crafted WhatsApp contact-share message can put in
    // `contact.name` — a JSON string field can legitimately decode to a
    // real newline byte, which is the vCard's own line separator.
    const text = toVCard({
      name: "Maria\nEMAIL:evil@x.test",
      emails: ["maria@example.test"],
    });
    // Exactly one real EMAIL: line — the honest one — and the attacker's
    // stayed inside FN's own value, escaped rather than raw.
    const emailLines = text.split("\n").filter((line) => line.startsWith("EMAIL:"));
    expect(emailLines).toEqual(["EMAIL:maria@example.test"]);
    // The escaped newline reads back as the literal character it was —
    // `unescapeVCardValue` is the reader's own inverse of this.
    const fn = /^FN:(.*)$/m.exec(text)?.[1];
    expect(fn).toBe("Maria\\nEMAIL:evil@x.test");
    expect(unescapeVCardValue(fn ?? "")).toBe("Maria\nEMAIL:evil@x.test");
  });

  test("a backslash immediately before a literal n round-trips (the naive multi-replace trap)", () => {
    const text = toVCard({ name: "Maria\\n Notes" });
    const fn = /^FN:(.*)$/m.exec(text)?.[1] ?? "";
    expect(unescapeVCardValue(fn)).toBe("Maria\\n Notes");
  });
});

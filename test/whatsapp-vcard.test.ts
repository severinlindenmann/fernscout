import { describe, expect, test } from "vitest";
import { toVCard } from "@/lib/whatsapp/vcard";

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
});

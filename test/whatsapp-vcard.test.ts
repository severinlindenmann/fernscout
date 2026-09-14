import { describe, expect, test } from "vitest";
import { parseInboundMessages } from "@/lib/whatsapp/inbound";
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

  // B1738 — a shared contact's postal address, dropped by the inbound
  // parser until now.
  test("an address becomes RFC 6350's seven-component ADR line", () => {
    const text = toVCard({
      name: "Maria",
      addresses: [{ street: "Bahnhofstrasse 1", city: "Zurich", state: "ZH", zip: "8001", country: "Switzerland" }],
    });
    const adr = /^ADR:(.*)$/m.exec(text)?.[1];
    // post-office-box;extended;street;locality;region;postal-code;country —
    // the first two are always empty because Meta's message never carries
    // them.
    expect(adr).toBe(";;Bahnhofstrasse 1;Zurich;ZH;8001;Switzerland");
  });

  test("a semicolon inside an address component is escaped, not read as the next component", () => {
    const text = toVCard({ addresses: [{ street: "Suite 3; Building B", city: "Bern" }] });
    const adr = /^ADR:(.*)$/m.exec(text)?.[1];
    // Exactly 7 unescaped-semicolon-separated components, still — the one
    // inside "Suite 3; Building B" is `\;`, not a bare `;`.
    expect(adr).toBe(";;Suite 3\\; Building B;Bern;;;");
  });

  test("no address means no ADR line — a card with no address stages the same bytes it did before", () => {
    const text = toVCard({ name: "Maria", emails: ["maria@example.test"] });
    expect(text).not.toContain("ADR");
    expect(text).toBe(
      ["BEGIN:VCARD", "VERSION:3.0", "FN:Maria", "EMAIL:maria@example.test", "END:VCARD"].join("\n") + "\n",
    );
  });

  test("a webhook contacts message carrying addresses[] stages a .vcf with a correctly escaped ADR line", () => {
    // Meta's own shape (WhatsApp Cloud API), reduced to what B1738 reads:
    // `contacts[].addresses[]` alongside the already-read `phones[]` and
    // `emails[]`.
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.contact-adr",
                    from: "41760000009",
                    timestamp: "1710000000",
                    type: "contacts",
                    contacts: [
                      {
                        name: { formatted_name: "Maria" },
                        phones: [{ phone: "+41791234567" }],
                        emails: [{ email: "maria@example.test" }],
                        addresses: [
                          {
                            street: "Bahnhofstrasse 1",
                            city: "Zurich",
                            state: "ZH",
                            zip: "8001",
                            country: "Switzerland",
                            country_code: "CH",
                            type: "HOME",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [message] = parseInboundMessages(body);
    expect(message.kind).toBe("contacts");
    if (message.kind !== "contacts") throw new Error("expected a contacts message");
    const text = toVCard(message.contacts[0]);
    expect(text).toContain("FN:Maria");
    expect(text).toContain("TEL:+41791234567");
    expect(text).toContain("EMAIL:maria@example.test");
    expect(text).toContain("ADR:;;Bahnhofstrasse 1;Zurich;ZH;8001;Switzerland");
  });
});

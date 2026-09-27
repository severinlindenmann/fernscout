import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { digestPreviews } from "@/lib/messages/previews/digest";

/**
 * B2493 group B — every id this group owns is registered, and at least one
 * localised template actually carries the real German string rather than a
 * fixture the composer invented for itself.
 */
const GROUP_B_IDS = [
  "news.mail",
  "nudge.evening",
  "nudge.first.mail",
  "nudge.first.push",
  "op.spend",
  "op.alert",
  "code.sms",
  "invite.sms",
  "invite.in.sms",
  "invite.share",
  "news.sms",
  "op.sms",
  "news.push",
  "news.wa",
] as const;

describe("digest group previews (B2493 group B)", () => {
  it("registers every template this group owns", () => {
    for (const id of GROUP_B_IDS) {
      expect(Object.keys(digestPreviews), id).toContain(id);
    }
  });

  it("code.sms in de carries the real German locale string, not fixture copy", async () => {
    const de = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "site", "locales", "de.json"), "utf8")) as Record<
      string,
      string
    >;
    // The real key `code.sms`'s composer reads (`contact.smsCodeBody`) —
    // read straight from the locale file so this test cannot drift from it.
    const template = de["contact.smsCodeBody"];
    expect(template, "contact.smsCodeBody missing from de.json").toBeTruthy();
    // Turn "{code} ist dein Code für {title}. Er gilt {minutes} Minuten." into
    // a substring every real fill would still contain: the words around the
    // placeholders.
    const words = template
      .split(/\{[^}]+\}/)
      .map((s) => s.trim())
      .filter(Boolean);
    const composed = await digestPreviews["code.sms"]!("de");
    expect(composed.channel).toBe("sms");
    const text = "text" in composed ? composed.text : "";
    for (const word of words) expect(text).toContain(word);
  });
});

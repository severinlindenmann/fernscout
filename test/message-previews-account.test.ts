import { describe, expect, it } from "vitest";
import { accountPreviews } from "@/lib/messages/previews/account";
import { translateIn } from "@/lib/locales";

/**
 * B2493 group A — the templates this group's composers cover really are
 * registered, and a localised one actually renders the recipient's
 * language rather than falling back to English.
 */
describe("account message previews (B2493 group A)", () => {
  const GROUP_A_TEMPLATE_IDS = [
    "code.mail",
    "code.identity.mail",
    "code.journal.mail",
    "code.signup.mail",
    "code.ownerEmail.mail",
    "invite.mail",
    "invite.in.mail",
    "notice.request",
    "notice.delete",
    "notice.export",
    "notice.moved",
    "notice.storage",
    "notice.waitlist",
    "notice.welcome",
    "notice.expiryWarn",
    "notice.expiryFinal",
    "notice.operatorMessage",
  ] as const;

  it("registers every group A template id", () => {
    for (const id of GROUP_A_TEMPLATE_IDS) {
      expect(Object.keys(accountPreviews), id).toContain(id);
    }
  });

  it("renders real German text for a localised template (code.mail)", async () => {
    const composed = await accountPreviews["code.mail"]!("de");
    expect(composed.channel).toBe("mail");
    if (composed.channel !== "mail") return;
    // Whatever wording the real send would pick for a link-carrying code
    // mail (contact.mailCodeIgnore is always present, with or without a
    // link) — the real German dictionary entry, not a string this test
    // invented.
    const german = translateIn("de", "contact.mailCodeIgnore");
    const text = composed.content.blocks
      .map((b) => ("text" in b ? b.text : ""))
      .join("\n");
    expect(text).toContain(german);
  });
});

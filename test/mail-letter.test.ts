import { describe, expect, test } from "vitest";
import { renderMail, type MailContent } from "@/lib/mail/template";
import { translateIn } from "@/lib/locales";
import type { TemplateId } from "@/lib/messages/registry";

/**
 * B2440 — the one letter: a text-wordmark header with a yellow dot (never an
 * `<img>`), and a footer that always says why, localized, before it ever
 * offers to stop. One render per family named in W44's letter table, plus the
 * one rule the code family alone gets: never a manage line, never
 * `List-Unsubscribe`.
 */

function contentFor(template: TemplateId, extra: Partial<MailContent> = {}): MailContent {
  return {
    template,
    preheader: "preheader",
    title: "Title",
    blocks: [{ kind: "paragraph", text: "Body." }],
    why: "Because you asked.",
    locale: "de",
    ...extra,
  };
}

describe("the header", () => {
  test("is a text wordmark and a yellow dot — never an <img>", () => {
    const mail = renderMail("r@example.test", "S", contentFor("code.mail"));
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("border-radius:50%;background:#ffd23f");
    expect(mail.html).toContain("Fernscout"); // the default site name in tests
  });

  test("names the journal for reader mail, the site for account mail", () => {
    const reader = renderMail("r@example.test", "S", contentFor("news.mail", { journalTitle: "Two Backpacks" }));
    expect(reader.html).toContain("Two Backpacks");

    const account = renderMail("r@example.test", "S", contentFor("code.mail"));
    // No journalTitle given — falls back to the site name, not a blank cell.
    expect(account.html).toContain("Fernscout");
  });
});

describe("the footer", () => {
  test.each<[string, TemplateId]>([
    ["code", "code.mail"],
    ["invite", "invite.mail"],
    ["news", "news.mail"],
    ["receipt", "receipt.plan"],
    ["notice", "notice.storage"],
    ["operator", "op.alert"],
  ])("%s: a localized 'why you got this' line, always", (_name, template) => {
    const mail = renderMail("r@example.test", "S", contentFor(template));
    expect(mail.html).toContain(translateIn("de", "mail.whyLabel"));
    expect(mail.html).toContain("Because you asked.");
    expect(mail.text).toContain(translateIn("de", "mail.whyLabel"));
  });

  test("code mail never gets a manage link or a List-Unsubscribe header, even if asked", () => {
    const mail = renderMail(
      "r@example.test",
      "S",
      contentFor("code.mail", { manage: { text: "Stop", href: "https://x.test/stop" } }),
    );
    expect(mail.html).not.toContain("https://x.test/stop");
    expect(mail.headers?.["List-Unsubscribe"]).toBeUndefined();
    expect(mail.text).not.toContain("Stop:");
  });

  test("a family that allows one gets the manage line and the header", () => {
    const mail = renderMail(
      "r@example.test",
      "S",
      contentFor("news.mail", { manage: { text: "Stop these emails", href: "https://x.test/stop" } }),
    );
    expect(mail.html).toContain("https://x.test/stop");
    expect(mail.headers?.["List-Unsubscribe"]).toBe("<https://x.test/stop>");
  });
});

import { describe, expect, test } from "vitest";
import { composeSignupCodeMail } from "@/lib/signupCode";
import { composeIdentityCodeMail, composeJournalCodeMail } from "@/lib/mail/accountCodeCompositions";
import { renderMail } from "@/lib/mail/template";

/** B-2843 — every code mail leads with the code; the explanation is small print after it. */
const CODE = "482913";
const mails = {
  identity: composeIdentityCodeMail({ locale: "en", code: CODE, site: "Fernscout", link: "https://t.test/s/abc" }),
  signup: composeSignupCodeMail({ locale: "en", code: CODE, askedAt: "06:30", resumeUrl: "https://t.test/r/abc" }),
  guest: composeJournalCodeMail({
    locale: "en",
    code: CODE,
    siteName: "Fernscout",
    title: "Trip",
    for: "read",
    link: "https://t.test/s/abc",
    askedAt: "06:30",
  }),
};

describe("code mail order", () => {
  for (const [name, mail] of Object.entries(mails)) {
    test(`${name}: code first, in the preheader, as larger selectable text, safety line kept`, () => {
      const out = renderMail("a@example.test", mail.subject, mail.content);
      const html = out.html ?? "";
      const text = out.text ?? "";
      expect(mail.subject.startsWith(CODE)).toBe(true);
      expect(mail.content.preheader).toContain(CODE);
      // Text part: code before any explanation. HTML part: the visible code
      // (after the hidden preheader) precedes the safety line.
      expect(text.indexOf(CODE)).toBeGreaterThan(-1);
      expect(text.indexOf("ignore")).toBeGreaterThan(text.indexOf(CODE));
      const visibleCode = html.indexOf(`>${CODE}</p>`);
      expect(visibleCode).toBeGreaterThan(-1);
      expect(html.indexOf("ignore")).toBeGreaterThan(visibleCode);
      expect(html).toMatch(new RegExp(`font:700 40px[^>]*>${CODE}</p>`));
      expect(html).not.toContain("<img");
      // The link is a text link after the code, not a button.
      expect(html.indexOf("https://t.test/")).toBeGreaterThan(visibleCode);
      expect(html).not.toContain("padding:14px 24px");
    });
  }
});

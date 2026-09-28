import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPreview } from "@/lib/messages/fixtures";
import { TEMPLATES, type TemplateId } from "@/lib/messages/registry";

/**
 * B2510 — a preview (and, since it calls the same composer, a real send)
 * of a mail template in German must have its chrome (renderMail's own
 * "Why you got this:" label) in German too, not stuck on English because
 * the composer built its MailContent with no `locale`.
 *
 * Four operator-only templates are English by design regardless of
 * locale (see each composer's own comment) — excluded here.
 */
const ENGLISH_BY_DESIGN: TemplateId[] = [
  "op.spend",
  "op.alert",
  "op.grantApproval",
  "notice.operatorMessage",
];

const en = JSON.parse(readFileSync(path.join(process.cwd(), "site/locales/en.json"), "utf8"));
const de = JSON.parse(readFileSync(path.join(process.cwd(), "site/locales/de.json"), "utf8"));
const enWhyLabel: string = en["mail.whyLabel"];
const deWhyLabel: string = de["mail.whyLabel"];

describe("mail chrome follows the composer's own locale (B2510)", () => {
  for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
    if (TEMPLATES[id].channel !== "mail") continue;
    if (ENGLISH_BY_DESIGN.includes(id)) continue;

    it(`${id} de preview has German chrome, not English`, async () => {
      const p = await buildPreview(id, "de");
      if ("freeform" in p) return; // no fixed text to check (none expected here, but harmless)
      expect(p.text).not.toContain(enWhyLabel);
      expect(p.text).toContain(deWhyLabel);
    });
  }
});

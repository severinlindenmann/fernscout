import { describe, expect, it } from "vitest";
import { buildPreview, PREVIEW_LOCALES } from "@/lib/messages/fixtures";
import { TEMPLATES, type TemplateId } from "@/lib/messages/registry";

describe("admin message previews (B2493)", () => {
  it("renders every template in every preview locale", async () => {
    for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
      for (const locale of PREVIEW_LOCALES) {
        const p = await buildPreview(id, locale);
        expect(p.channel, id).toBe(TEMPLATES[id].channel);
        expect(p.text.trim().length, `${id} ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});

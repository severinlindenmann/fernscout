import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REGISTRY } from "@/lib/helper/intents";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B729 — a registry row's slot is shown with `t(`agent.slot.${name}`)`, cast
 * through `as TranslationKey` in `components/HelperAsk.tsx`. The cast makes
 * it compile even when nobody added the key, and a slot with no translation
 * then renders its own raw key on the page instead of failing the build.
 *
 * This walks every slot in `REGISTRY` against every maintained locale's own
 * file on disk — not the English-merged dictionary, which would hide a slot
 * missing from one language behind English's copy of the same key.
 */
describe("every intent slot has a locale string in every maintained locale", () => {
  const slotNames = [...new Set(REGISTRY.flatMap((row) => row.slots.map((slot) => slot.name)))];

  for (const locale of MAINTAINED_LOCALES) {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
    ) as Record<string, string>;

    for (const name of slotNames) {
      test(`${locale}: agent.slot.${name}`, () => {
        expect(dictionary[`agent.slot.${name}`]).toBeTypeOf("string");
        expect(dictionary[`agent.slot.${name}`]?.length).toBeGreaterThan(0);
      });
    }
  }
});

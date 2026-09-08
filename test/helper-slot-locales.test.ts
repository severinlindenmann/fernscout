import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TOOLS } from "@/lib/helper/tools";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B729 — a proposal's field is labelled with `t(`agent.slot.${name}`)`, cast
 * through `as TranslationKey` in `components/HelperAsk.tsx`. The cast makes
 * it compile even when nobody added the key, and a field with no translation
 * then renders its own raw key on the page instead of failing the build.
 *
 * Since B900 the fields come from the write tools, and their names are the
 * arguments those tools declare — which is also what the route they post to
 * reads. This walks every one against every maintained locale's own file on
 * disk, not the English-merged dictionary, which would hide a field missing
 * from one language behind English's copy of the same key.
 */
describe("every proposal field has a locale string in every maintained locale", () => {
  const slotNames = [
    ...new Set(
      TOOLS.filter((tool) => tool.kind === "write").flatMap((tool) => Object.keys(tool.properties)),
    ),
  ];

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

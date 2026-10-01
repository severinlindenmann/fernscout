import { describe, expect, test } from "vitest";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B2651 — iOS motion data has no train or bus, so the recorder writes those
 * stretches as "car". The route page must not assert a car: its label for
 * the recorded "car" mode names train and bus too, in every language.
 */
describe("the recorded car mode is said as car, train or bus", () => {
  for (const locale of MAINTAINED_LOCALES) {
    test(locale, () => {
      const d = dictionaryFor(locale);
      const label = d["studio.location.route.mode.car"];
      expect(label).toContain(d["studio.location.route.mode.train"].split(" ").at(-1)!.replace(/^mit$/, ""));
    });
  }
});

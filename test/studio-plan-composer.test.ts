import { describe, expect, test } from "vitest";
import { uniqueCandidates } from "@/components/studio/plan/Composer";
import { plural } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";

/** B2086 — the planner's small wording and list defects, pinned. */
describe("nights are counted in the plural the count needs", () => {
  // Hungarian keeps "éjszaka" after a numeral, so only the key's presence is
  // shared; en and de change the word.
  test.each(["en", "de", "hu"] as const)("%s: a singular form exists for one night", (locale) => {
    const dict = dictionaryFor(locale);
    expect(dict["studio.plan.confirm.nightCount.one"]).toBeTruthy();
    const dated = plural(dict, "studio.plan.list.nightsAndDates", 1, { nights: "1", arrive: "1 Apr", leave: "2 Apr" });
    expect(dated).toContain("1 Apr");
    expect(dated).toContain("2 Apr");
  });

  test("en reads 1 night, 3 nights", () => {
    const dict = dictionaryFor("en");
    expect(plural(dict, "studio.plan.confirm.nightCount", 1, { count: "1" })).toBe("1 night");
    expect(plural(dict, "studio.plan.confirm.nightCount", 3, { count: "3" })).toBe("3 nights");
    expect(plural(dictionaryFor("de"), "studio.plan.confirm.nightCount", 1, { count: "1" })).toBe("1 Nacht");
  });
});

test("OSM suggestions with the same label collapse to one row", () => {
  const c = (displayName: string, lat: number) => ({ displayName, country: "Japan", lat, lon: 132 });
  const rows = uniqueCandidates([
    c("Matsuyama, Ehime Prefecture, Japan", 33.84),
    c("Matsuyama, Ehime Prefecture, Japan", 33.83),
    c("Matsuyama, Itoda, Fukuoka Prefecture, Japan", 33.6),
  ]);
  expect(rows.map((r) => r.lat)).toEqual([33.84, 33.6]);
});

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Structured outputs refuse some JSON Schema keywords with a 400 on every
 * call — `maxItems` broke the figure-from-photo call and TIX-2's title
 * suggestions until removed. Counts are capped after parsing instead.
 */
test("no model schema uses a keyword structured outputs refuses", () => {
  const source = readFileSync("lib/helper/model.ts", "utf8");
  const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*)/.test(line)).join("\n");
  for (const keyword of ["maxItems", "maxLength", "minLength", "minimum", "maximum", "pattern", "uniqueItems"]) {
    expect(code, keyword).not.toMatch(new RegExp(`\\b${keyword}:`));
  }
});

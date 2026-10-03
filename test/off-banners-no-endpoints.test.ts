import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

describe("owner copy for switched-off studio pages", () => {
  it.each(MAINTAINED_LOCALES)("%s names no endpoint path", (locale) => {
    const strings = JSON.parse(readFileSync(`site/locales/${locale}.json`, "utf8")) as Record<string, string>;
    for (const [key, value] of Object.entries(strings)) {
      if (/^studio\.\w+\.off\.(banner|body)$/.test(key) || key === "postcard.status.sampleNote") {
        expect(value, key).not.toMatch(/\/api\//);
      }
    }
  });
});

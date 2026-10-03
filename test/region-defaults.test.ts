import { describe, expect, test } from "vitest";
import { browserRegion, regionDefaults } from "@/lib/regionDefaults";

describe("regionDefaults (B-2807)", () => {
  test("de-CH is CHF and +41", () => {
    expect(regionDefaults(["de-CH", "en"])).toEqual({ region: "CH", currency: "CHF", cc: "41" });
  });
  test("a bare language guesses nothing", () => {
    expect(regionDefaults(["en", "de"])).toEqual({ region: null, currency: null, cc: null });
    expect(regionDefaults([])).toEqual({ region: null, currency: null, cc: null });
  });
  test("the first tag with an explicit region wins, a script tag is not a region", () => {
    expect(browserRegion(["en", "zh-Hant", "de-AT", "fr-CH"])).toBe("AT");
    expect(regionDefaults(["en", "de-AT"]).currency).toBe("EUR");
  });
  test("a malformed tag is skipped", () => {
    expect(browserRegion(["not a tag!!", "fr-CH"])).toBe("CH");
  });
});

import { describe, expect, test } from "vitest";
import { browserRegion, countryForTel, regionDefaults, resolveCurrency } from "@/lib/regionDefaults";

describe("countryForTel (B-2845)", () => {
  test("longest dial code wins; a shared code with several currencies names nothing", () => {
    expect(countryForTel("41760000001")).toBe("CH");
    expect(countryForTel("12125550100")).toBeNull();
    expect(countryForTel("12125550100", "CA")).toBe("CA");
    expect(countryForTel("999")).toBeNull();
  });
});

describe("resolveCurrency (B-2845)", () => {
  const r = (phoneCountry: string | null, timeZone: string | null, languages: string[]) =>
    resolveCurrency({ phoneCountry, timeZone, languages });
  test("a Swiss number beats en-GB", () => {
    expect(r("CH", "Europe/Zurich", ["en-GB"])).toMatchObject({ currency: "CHF", source: "phone", alternatives: [] });
  });
  test("number and time zone disagreeing return both, the number's first", () => {
    expect(r("CH", "Europe/London", ["en-GB"])).toMatchObject({ currency: "CHF", alternatives: ["CHF", "GBP"] });
  });
  test("without a number the time zone beats the language", () => {
    expect(r(null, "Europe/Zurich", ["en-GB"])).toMatchObject({ currency: "CHF", source: "timeZone" });
  });
  test("the language region is the last resort", () => {
    expect(r(null, "UTC", ["en-GB"])).toMatchObject({ currency: "GBP", source: "language" });
  });
  test("UTC and a bare language resolve to nothing", () => {
    expect(r(null, "UTC", ["en"])).toMatchObject({ currency: null, source: null, alternatives: [] });
  });
});

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

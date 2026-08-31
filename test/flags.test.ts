import { describe, expect, test } from "vitest";
import { COUNTRY_CODES } from "@/lib/countryCodes";
import { countryCodeFor, flagFor } from "@/lib/flags";
/**
 * Flags for places the author of this software will never go.
 *
 * The lookup table used to be 44 countries chosen as "places we're likely to
 * pass through" — no United States, Canada or United Kingdom — while the
 * documentation said, and still says, that `countryCode` is optional because
 * the code is looked up from `country`. A journal across America therefore
 * showed no flags at all. It is generated from GeoNames now; this is the guard
 * that it stays complete.
 */
describe("country codes", () => {
  test("covers the countries a stranger's journal is most likely to name", () => {
    for (const [name, code] of [
      ["United States", "US"],
      ["Canada", "CA"],
      ["United Kingdom", "GB"],
      ["Australia", "AU"],
      ["Germany", "DE"],
      ["Japan", "JP"],
      ["Brazil", "BR"],
      ["South Africa", "ZA"],
      ["India", "IN"],
      ["Norway", "NO"],
    ] as const) {
      expect(countryCodeFor(name), name).toBe(code);
    }
  });

  test("accepts what people actually type", () => {
    expect(countryCodeFor("USA")).toBe("US");
    expect(countryCodeFor("UK")).toBe("GB");
    expect(countryCodeFor("Holland")).toBe("NL");
    expect(countryCodeFor("  switzerland  ")).toBe("CH");
  });

  test("an explicit countryCode still wins", () => {
    expect(countryCodeFor("United States", "gb")).toBe("GB");
  });

  test("an unknown country is empty, not a wrong flag", () => {
    expect(countryCodeFor("Nowhereland")).toBeUndefined();
    expect(flagFor("Nowhereland")).toBe("");
    expect(flagFor("")).toBe("");
  });

  test("the table is a full one, not a shortlist", () => {
    expect(Object.keys(COUNTRY_CODES).length).toBeGreaterThan(200);
  });
});

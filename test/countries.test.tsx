import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { COUNTRIES, countryName, filterCountryList, flagOf, resolveCountry } from "@/lib/countries";
import CountryField from "@/components/CountryField";

/**
 * B398 — the country on a postal address, lifted out of free text.
 *
 * `lib/countries.ts` is where B390's `TelField` table and its two helpers
 * moved to when the address picker needed the same data; `test/tel-field.test.ts`
 * still pins `flagOf`/`countryName`/`DIAL_CODES` through `TelField`'s own
 * re-exports, so this file is only what B398 actually added:
 * `filterCountryList`, `resolveCountry`, and the picker component itself.
 */

describe("filterCountryList — the postal address picker's own search, no dial digits", () => {
  test("matches by (translated) country name", () => {
    expect(filterCountryList("swi", "en").some((c) => c.iso2 === "CH")).toBe(true);
  });

  test("matches by ISO2 code, case-insensitively", () => {
    expect(filterCountryList("ch", "en").some((c) => c.iso2 === "CH")).toBe(true);
  });

  test("no match returns an empty list", () => {
    expect(filterCountryList("zzzznotacountry", "en")).toEqual([]);
  });

  test("empty query returns everything, sorted by name in that locale", () => {
    const all = filterCountryList("", "de");
    expect(all.length).toBe(COUNTRIES.length);
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name, "de"));
    expect(all).toEqual(sorted);
  });

  test("matches the English name on a non-English journal (B423)", () => {
    // On a `de` journal the list is named in German ("Schweiz"); "swi" must
    // still find Switzerland via its English name, not only via "Schw"/"CH".
    expect(filterCountryList("swi", "de").some((c) => c.iso2 === "CH")).toBe(true);
  });
});

describe("resolveCountry — B398's legacy-row rule", () => {
  test("a bare ISO2 code resolves to itself", () => {
    expect(resolveCountry("CH", ["en"])).toBe("CH");
    expect(resolveCountry("ch", ["en"])).toBe("CH"); // case-insensitive
  });

  test("a name in one of the journal's own locales resolves", () => {
    expect(resolveCountry("Schweiz", ["de", "en"])).toBe("CH");
    expect(resolveCountry("  schweiz  ", ["de", "en"])).toBe("CH"); // whitespace-insensitive
  });

  test("the English name always resolves, even for a journal that speaks none of it", () => {
    expect(resolveCountry("Switzerland", ["de", "hu"])).toBe("CH");
  });

  test("free text nobody's Intl.DisplayNames output matches stays unresolved", () => {
    expect(resolveCountry("Elbonia", ["en"])).toBeNull();
  });

  test("empty string resolves to nothing, same as an address with no country yet", () => {
    expect(resolveCountry("", ["en"])).toBeNull();
  });
});

/**
 * The picker itself, checked the way `test/contact-address-fieldset.test.tsx`
 * checks `GuestForm` — static markup, no DOM interaction, since this checkout
 * runs vitest in the `"node"` environment. Enough to pin B398's Acceptance
 * section without a testing-library dependency this project doesn't have.
 */
describe("CountryField — what's on the page before anyone touches it", () => {
  const props = {
    id: "test-country",
    onChange: () => {},
    label: "Country",
    searchPlaceholder: "Type a country",
    noMatches: "No country matches that",
  };

  test("a brand-new address: nothing selected, nothing typed", () => {
    const html = renderToStaticMarkup(
      <CountryField {...props} value="" locales={["en"]} locale="en" />,
    );
    expect(html).toMatch(/value=""/);
  });

  test("a legacy 'Schweiz' resolves and renders the reader's own language", () => {
    const en = renderToStaticMarkup(
      <CountryField {...props} value="Schweiz" locales={["de", "en"]} locale="en" />,
    );
    expect(en).toContain(flagOf("CH"));
    expect(en).toContain(countryName("CH", "en")); // "Switzerland"

    const de = renderToStaticMarkup(
      <CountryField {...props} value="Schweiz" locales={["de", "en"]} locale="de" />,
    );
    expect(de).toContain(countryName("CH", "de")); // "Schweiz"
  });

  test("'Elbonia' is preserved as typed, with nothing selected", () => {
    const html = renderToStaticMarkup(
      <CountryField {...props} value="Elbonia" locales={["en"]} locale="en" />,
    );
    expect(html).toContain("Elbonia");
    expect(html).not.toContain(flagOf("CH"));
  });
});

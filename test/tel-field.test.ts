import { describe, expect, test } from "vitest";
import { DIAL_CODES, filterCountries, flagOf, joinTel, splitTel } from "@/components/TelField";
import { toE164 } from "@/lib/whatsapp/phone";

/**
 * B385 — the dialling-code select next to the four free-text phone boxes —
 * and B390, which turned its curated eleven into every country with a search
 * box on top.
 *
 * `splitTel`/`joinTel` are the whole of what changed about storage: one
 * `PostalAddress.tel` string, still `+<cc> <national>`, still read by
 * `toE164`'s own `+` branch. These pin the round trip the ticket's
 * Acceptance section asks for, and the two parse-back cases — a value this
 * picker wrote itself, and a legacy row nobody ever touched with it.
 *
 * `filterCountries` and `flagOf` are tested directly, without rendering the
 * component, because this checkout has no DOM testing library (`vitest.config`
 * runs in the `"node"` environment) — the same reason `splitTel`/`joinTel`
 * were pulled out as plain functions rather than tested through a render.
 */

describe("splitTel / joinTel", () => {
  test("+41 + 765613150 round-trips through storage with no defaultCountryCode needed", () => {
    const stored = joinTel("41", "765613150");
    const back = splitTel(stored);
    expect(back).toEqual({ cc: "41", national: "765613150" });
    expect(toE164(stored)).toBe("41765613150");
  });

  test("parses back a stored value written as typed with spaces", () => {
    expect(splitTel("+41 76 561 31 50")).toEqual({ cc: "41", national: "76 561 31 50" });
  });

  test("a legacy national number has no country to find, and is shown as typed", () => {
    // No leading `+`, so there is nothing for this picker to have written —
    // exactly the row B385 exists to stop from being created going forward,
    // and exactly what must not be guessed at when it already exists.
    expect(splitTel("076 561 31 50")).toEqual({ cc: "", national: "076 561 31 50" });
  });

  test("a code no ITU country actually uses is left unselected rather than guessed", () => {
    // +999 answers to nobody — DIAL_CODES now covers every country (B390),
    // so this is the one case left where a leading `+` still cannot be
    // placed, and it must still be shown as typed rather than reinterpreted.
    expect(splitTel("+999 1234567")).toEqual({ cc: "", national: "+999 1234567" });
  });

  test("B390 widened the table from eleven countries to every ITU dialling code", () => {
    // Russia (+7) and most of the world outside western Europe and North
    // America had no row at all before this ticket — that gap is the Why.
    expect(DIAL_CODES.some((d) => d.iso2 === "RU" && d.cc === "7")).toBe(true);
    expect(DIAL_CODES.length).toBeGreaterThan(200);
  });

  test("no country picked, no digits typed: joinTel stores the empty string", () => {
    expect(joinTel("", "")).toBe("");
  });

  test("digits with no country picked store as bare digits, same as before this ticket", () => {
    expect(joinTel("", "076 561 31 50")).toBe("076 561 31 50");
  });

  test("a country picked with the digits cleared stores no bare '+cc' — clearing the number does not half-save a country", () => {
    expect(joinTel("41", "  ")).toBe("");
  });
});

describe("filterCountries — the search box's match rules (B390)", () => {
  test("matches by (translated) country name", () => {
    const hits = filterCountries("swi", "en");
    expect(hits.some((d) => d.iso2 === "CH")).toBe(true);
  });

  test("matches by ISO2 code, case-insensitively", () => {
    const hits = filterCountries("CH", "en");
    expect(hits.some((d) => d.iso2 === "CH")).toBe(true);
    // Nothing that is not actually Switzerland should turn up for its code —
    // "ch" is not a substring of any other name/iso2/cc combination that
    // matters here, but the assertion is on CH being found, not on the size
    // of the result, since "ch" also happens to appear inside "Chad" (TD)
    // and "China" (CN) as a name-substring — which is correct: a filter that
    // matches "name contains query" is supposed to find those too.
  });

  test("matches by dial-code digits", () => {
    const hits = filterCountries("41", "en");
    expect(hits.some((d) => d.iso2 === "CH" && d.cc === "41")).toBe(true);
  });

  test("country names come from Intl.DisplayNames, translated per locale", () => {
    const ch = filterCountries("", "de").find((d) => d.iso2 === "CH");
    expect(ch?.name).toBe("Schweiz");
  });

  test("no match returns an empty list rather than falling back to everything", () => {
    expect(filterCountries("zzzznotacountry", "en")).toEqual([]);
  });
});

describe("flagOf — regional-indicator flags with no image asset (B390)", () => {
  test("a known code derives its flag from its two letters", () => {
    // 🇨🇭 is U+1F1E8 U+1F1ED — the regional indicators for C and H.
    expect(flagOf("CH")).toBe("\u{1F1E8}\u{1F1ED}");
  });

  test("is case-insensitive, since DIAL_CODES stores upper case but a caller might not", () => {
    expect(flagOf("ch")).toBe(flagOf("CH"));
  });
});

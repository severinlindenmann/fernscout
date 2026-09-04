import { describe, expect, test } from "vitest";
import { joinTel, splitTel } from "@/components/TelField";
import { toE164 } from "@/lib/whatsapp/phone";

/**
 * B385 — the dialling-code select next to the four free-text phone boxes.
 *
 * `splitTel`/`joinTel` are the whole of what changed about storage: one
 * `PostalAddress.tel` string, still `+<cc> <national>`, still read by
 * `toE164`'s own `+` branch. These pin the round trip the ticket's
 * Acceptance section asks for, and the two parse-back cases — a value this
 * picker wrote itself, and a legacy row nobody ever touched with it.
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

  test("a country this picker does not offer is left unselected rather than guessed", () => {
    // +7 (Russia) is not in DIAL_CODES — the honest gap the doc comment
    // names. Reinterpreting a code this picker cannot show in its own select
    // would be exactly the silent guess the ticket forbids.
    expect(splitTel("+7 9161234567")).toEqual({ cc: "", national: "+7 9161234567" });
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

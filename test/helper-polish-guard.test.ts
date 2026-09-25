import { describe, expect, it } from "vitest";
import { checkPolishForAddedFacts } from "@/lib/helper/polishGuard";

describe("checkPolishForAddedFacts", () => {
  it("accepts reordering, punctuation and casing fixes", () => {
    const input = "rain all morning then port at grahams";
    const output = "Rain all morning, then port at Graham's.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  it("accepts a sentence-initial capital that was lowercase in the input", () => {
    const input = "we walked along the river and had lunch";
    const output = "We walked along the river and had lunch.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  it("rejects an added number", () => {
    const input = "we walked to the port and back";
    const output = "We walked 5 kilometers to the port and back.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("rejects an added name", () => {
    const input = "rain all morning then port at grahams";
    const output = "Rain all morning, then we met Paris at the port.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("rejects an added place", () => {
    const input = "we hiked all day and it was tiring";
    const output = "We hiked through the Alps all day and it was tiring.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("rejects an added currency/measurement unit", () => {
    const input = "bought lunch for the family, quite pricey";
    const output = "Bought lunch for the family for 40 CHF, quite pricey.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("keeps a number that was already in the input", () => {
    const input = "we walked 5 kilometers to the port and back";
    const output = "We walked 5 kilometers to the port and back.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  it("keeps a unit that was already in the input", () => {
    const input = "bought lunch for 40 CHF, quite pricey";
    const output = "Bought lunch for 40 CHF — quite pricey.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  // The live bug this guard was extended to catch: "rain all morning then
  // port at grahams" (no subject at all) came back as "...then we arrived
  // at port..." — a person and an action neither one was told.
  it("rejects a pronoun introduced where the input named no subject", () => {
    const input = "rain all morning then port at grahams";
    const output = "Rain all morning, then we arrived at port at Graham's.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("keeps a pronoun that was already in the input", () => {
    const input = "we hiked all day, I was tired";
    const output = "We hiked all day — I was tired.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  // "it" is deliberately not on `PRONOUN_WORDS` — an impersonal "it" is not
  // a person the way "we"/"she" are. But since the sentence-initial
  // exemption was dropped (below), a capitalised "It" that completes a
  // subject-less fragment into a sentence is still caught by the ordinary
  // capitalised-word check, because "it" simply is not a word the owner
  // used — which is the right outcome given the tightened prompt says a
  // fragment stays a fragment rather than being given any subject at all.
  it("keeps an impersonal 'it' that the input already used", () => {
    const input = "it rained all morning, it was tiring";
    const output = "It rained all morning — it was tiring.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  it("rejects an impersonal 'it' subject invented for a fragment that never had one", () => {
    const input = "rained all morning, tiring";
    const output = "It rained all morning — it was tiring.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  // B2190's second follow-up (security review, A1): a sentence-initial
  // capital used to be exempt from the check entirely, *and* its stem was
  // then added to a "seen" set that exempted the same word again later in
  // the same output — so "Zurich was lovely… in Zurich" passed a place the
  // input never named, because the second "Zurich" matched the first's own
  // leaked exemption rather than anything in the input.
  it("rejects a name introduced at a sentence start and reused mid-sentence (Zurich case)", () => {
    const input = "the old town was lovely, we wandered for hours";
    const output = "Zurich was lovely, we wandered around in Zurich for hours.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("still accepts a sentence-initial word that genuinely is in the input", () => {
    const input = "zurich was lovely, we wandered for hours";
    const output = "Zurich was lovely, we wandered for hours.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });

  // B2190's second follow-up (security review, A1b): `CAPITALISED` only
  // matched the Latin range À-Þ, so a Hungarian capital like Ő or Ű was
  // never even considered — `\p{Lu}` covers any script.
  it("rejects a Hungarian name outside the Latin range (Őrs case)", () => {
    const input = "sokáig sétáltunk a régi városban";
    const output = "Sokáig sétáltunk Őrs mellett a régi városban.";
    const result = checkPolishForAddedFacts(input, output);
    expect(result.ok).toBe(false);
  });

  it("accepts the same Hungarian capital when it was already in the input", () => {
    const input = "őrs mellett sétáltunk sokáig";
    const output = "Őrs mellett sétáltunk sokáig.";
    expect(checkPolishForAddedFacts(input, output)).toEqual({ ok: true });
  });
});

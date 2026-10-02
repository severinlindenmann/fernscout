import { describe, expect, test } from "vitest";
import { hasConsentFor, missingConsentScopes } from "@/lib/studio/featureConsent";

/**
 * B2676 — the per-feature consent decision, extracted so the Write page's
 * own sheets (voice behind `RecordButton`'s own consent; a future
 * receipt-reading sheet behind this directly) can share one answer to "is
 * there anything left to ask" rather than each re-deriving it.
 */

describe("missingConsentScopes", () => {
  test("voice needs only speech", () => {
    expect(missingConsentScopes("voice", { words: false, photos: false, speech: false })).toEqual(["speech"]);
    expect(missingConsentScopes("voice", { words: false, photos: false, speech: true })).toEqual([]);
    // Words/photos consent (or its absence) never affects voice.
    expect(missingConsentScopes("voice", { words: true, photos: true, speech: false })).toEqual(["speech"]);
  });

  test("suggest (receipt reading) needs both words and photos", () => {
    expect(missingConsentScopes("suggest", { words: false, photos: false, speech: true })).toEqual(["words", "photos"]);
    expect(missingConsentScopes("suggest", { words: true, photos: false, speech: false })).toEqual(["photos"]);
    expect(missingConsentScopes("suggest", { words: true, photos: true, speech: false })).toEqual([]);
  });
});

describe("hasConsentFor", () => {
  test("true only once every scope the feature needs is already given", () => {
    expect(hasConsentFor("voice", { words: false, photos: false, speech: true })).toBe(true);
    expect(hasConsentFor("voice", { words: true, photos: true, speech: false })).toBe(false);
    expect(hasConsentFor("suggest", { words: true, photos: true, speech: false })).toBe(true);
    expect(hasConsentFor("suggest", { words: true, photos: false, speech: true })).toBe(false);
  });
});

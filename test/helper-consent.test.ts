import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasHelperConsent,
  helperConsent,
  recordHelperConsent,
  revokeHelperConsent,
} from "@/lib/helper/consent";

/**
 * Consent storage — B743 and B735.
 *
 * **B743**: `providers` is a map keyed by scope, because a person consents to
 * a provider for a purpose, not to a provider globally. A file written before
 * the split (a single top-level `provider`) still reads, and reads as that
 * same name for every scope it already lists — never wider than what was
 * actually agreed to.
 *
 * **B735**: `revokeHelperConsent` takes a scope and rewrites rather than
 * deletes, unless the scope taken back was the last one standing.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-consent-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function consentFile(): string {
  return path.join(dir, "alex", "helper-consent.json");
}

describe("B743 — a provider per scope", () => {
  test("words and speech each keep their own provider", () => {
    recordHelperConsent("alex", "Anthropic", "words");
    recordHelperConsent("alex", "Deepgram", "speech");

    const consent = helperConsent("alex");
    expect(consent?.scopes.sort()).toEqual(["speech", "words"]);
    expect(consent?.providers.words).toBe("Anthropic");
    expect(consent?.providers.speech).toBe("Deepgram");
  });

  test("re-consenting to one scope with a new provider leaves the other alone", () => {
    recordHelperConsent("alex", "Anthropic", "words");
    recordHelperConsent("alex", "Deepgram", "speech");

    recordHelperConsent("alex", "SomeOtherModel", "words");

    const consent = helperConsent("alex");
    expect(consent?.providers.words).toBe("SomeOtherModel");
    expect(consent?.providers.speech).toBe("Deepgram");
  });

  test("a pre-B743 file with one top-level provider is read, never widened", () => {
    fs.writeFileSync(
      consentFile(),
      JSON.stringify({
        agreedAt: "2026-01-01T00:00:00.000Z",
        provider: "Anthropic",
        scopes: ["words", "photos"],
      }),
    );

    const consent = helperConsent("alex");
    expect(consent?.scopes.sort()).toEqual(["photos", "words"]);
    // Read as the same provider for every scope the old file already listed —
    // and nothing else. A scope the old file never granted must not appear.
    expect(consent?.providers.words).toBe("Anthropic");
    expect(consent?.providers.photos).toBe("Anthropic");
    expect(consent?.providers.speech).toBeUndefined();
    expect(hasHelperConsent("alex", "speech")).toBe(false);
  });
});

describe("B750 — a consented provider is checked against the one now configured", () => {
  // With no site config written in this file, `speechProvider()` reports
  // "dry-run" — the same default `lib/config.ts` uses when nothing is set.
  // Consenting to speech going to "Deepgram" therefore names a provider the
  // instance is not actually configured to use right now, the same shape as
  // an operator switching the backend out from under a standing consent.

  test("a scope granted under one provider is not honoured under a different one", () => {
    recordHelperConsent("alex", "Deepgram", "speech");
    expect(helperConsent("alex")?.scopes).toContain("speech"); // still recorded as granted...
    expect(hasHelperConsent("alex", "speech")).toBe(false); // ...but "Deepgram" != "dry-run".
  });

  test("consenting to whatever is configured now is honoured", () => {
    recordHelperConsent("alex", "dry-run", "speech");
    expect(hasHelperConsent("alex", "speech")).toBe(true);
  });

  test("a mismatch on one scope leaves the others untouched", () => {
    recordHelperConsent("alex", "Deepgram", "speech");
    recordHelperConsent("alex", "Anthropic", "words");

    expect(hasHelperConsent("alex", "speech")).toBe(false); // "Deepgram" != "dry-run"
    expect(hasHelperConsent("alex", "words")).toBe(true); // HELPER_PROVIDER is "Anthropic"
  });
});

describe("B735 — withdrawing one scope leaves the others standing", () => {
  test("revoking photos leaves words consent in place, and genuinely removes photos", () => {
    recordHelperConsent("alex", "Anthropic", "words");
    recordHelperConsent("alex", "Anthropic", "photos");
    expect(hasHelperConsent("alex", "words")).toBe(true);
    expect(hasHelperConsent("alex", "photos")).toBe(true);

    revokeHelperConsent("alex", "photos");

    // Not widened, not silently kept: photos is genuinely gone...
    expect(hasHelperConsent("alex", "photos")).toBe(false);
    expect(helperConsent("alex")?.providers.photos).toBeUndefined();
    // ...and words — the one nobody asked to withdraw — still stands.
    expect(hasHelperConsent("alex", "words")).toBe(true);
    expect(helperConsent("alex")?.providers.words).toBe("Anthropic");
  });

  /**
   * The file used to be deleted when its last scope went, and that was right
   * while every scope was off until somebody said yes: an absent file and a
   * file saying no meant the same thing.
   *
   * **B976 gave one scope a different default.** `sessions` starts on, so a
   * person turning it off is the only thing worth recording — and deleting
   * the file would have handed it back on next time anybody looked. So the
   * file survives to hold the no, with no scopes agreed to and nothing else
   * in it.
   */
  test("revoking the last scope leaves a file that remembers the no", () => {
    recordHelperConsent("alex", "Anthropic", "words");
    revokeHelperConsent("alex", "words");

    const after = helperConsent("alex");
    expect(after?.scopes).toEqual([]);
    expect(after?.declined).toEqual(["words"]);
    expect(fs.existsSync(consentFile())).toBe(true);
  });

  test("and saying yes again takes the no back", () => {
    revokeHelperConsent("alex", "words");
    recordHelperConsent("alex", "Anthropic", "words");

    const after = helperConsent("alex");
    expect(after?.scopes).toEqual(["words"]);
    expect(after?.declined ?? []).toEqual([]);
  });

  test("revoking a scope nobody agreed to is a no-op on the others", () => {
    recordHelperConsent("alex", "Anthropic", "words");
    revokeHelperConsent("alex", "speech");

    expect(hasHelperConsent("alex", "words")).toBe(true);
  });
});

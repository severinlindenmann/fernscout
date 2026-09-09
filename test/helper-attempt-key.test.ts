import { describe, expect, test } from "vitest";
import { attemptKeyFor } from "@/lib/helper/attemptKey";

/**
 * B719 — two different edits of the same length used to collide on
 * `AgentWizard`'s write-up idempotency key, because it was built from
 * `prose.length` rather than the prose itself. That sent the server's
 * `fingerprintOf` check a key it had already seen under a different body,
 * which answered the second edit `409` instead of writing it up.
 */
describe("attemptKeyFor", () => {
  test("two different edits of equal length get different keys", () => {
    const store = new Map<string, string>();
    const first = attemptKeyFor(store, "We walked to the lake.");
    const second = attemptKeyFor(store, "We drove past the ruin.");
    expect(first).not.toBe(second);
  });

  test("the same notes, tapped again, replay the same key", () => {
    const store = new Map<string, string>();
    const first = attemptKeyFor(store, "It rained all afternoon.");
    const second = attemptKeyFor(store, "It rained all afternoon.");
    expect(first).toBe(second);
  });

  test("the key is not the content itself, or a length", () => {
    const store = new Map<string, string>();
    const key = attemptKeyFor(store, "short");
    expect(key).not.toBe("short");
    expect(key).not.toBe("5");
  });
});

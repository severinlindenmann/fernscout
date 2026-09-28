import { describe, expect, test } from "vitest";
import { decidePaidLocaleKeysAction } from "../scripts/paid-locale-keys-lib.mjs";

/**
 * Whether `npm run i18n:keys` may rewrite lib/paidLocaleKeys.json this run —
 * B2515. Pure decision function, so every case is faked here rather than
 * depending on a real paid/ checkout (a live git status, a live commit, a
 * live ancestor check).
 */
describe("decidePaidLocaleKeysAction", () => {
  const isAncestorOf =
    (ancestors: Record<string, string[]>) =>
    (ancestor: string, descendant: string) =>
      (ancestors[descendant] ?? []).includes(ancestor) || ancestor === descendant;

  test("no paid/ — leaves the file alone with a one-line note", () => {
    const decision = decidePaidLocaleKeysAction({ paidExists: false });
    expect(decision.action).toBe("skip");
    expect(decision.message).toMatch(/No paid\/ here/);
  });

  test("first-ever generation — no previous commit recorded — writes", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: false,
      previousGeneratedFrom: null,
      currentCommit: "abc123",
      isAncestor: isAncestorOf({}),
      force: false,
    });
    expect(decision.action).toBe("write");
  });

  test("paid/ unchanged since last generation — writes (no-op downstream)", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: false,
      previousGeneratedFrom: "abc123",
      currentCommit: "abc123",
      isAncestor: isAncestorOf({}),
      force: false,
    });
    expect(decision.action).toBe("write");
  });

  test("paid/ moved forward from the recorded commit — writes", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: false,
      previousGeneratedFrom: "abc123",
      currentCommit: "def456",
      isAncestor: isAncestorOf({ def456: ["abc123"] }),
      force: false,
    });
    expect(decision.action).toBe("write");
  });

  test("paid/ is behind the recorded commit — refuses", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: false,
      previousGeneratedFrom: "def456",
      currentCommit: "abc123",
      isAncestor: isAncestorOf({ def456: ["abc123"] }),
      force: false,
    });
    expect(decision.action).toBe("refuse");
    expect(decision.message).toMatch(/stale paid\//);
  });

  test("paid/ has uncommitted changes — refuses even if the commit is fine", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: true,
      previousGeneratedFrom: "abc123",
      currentCommit: "abc123",
      isAncestor: isAncestorOf({}),
      force: false,
    });
    expect(decision.action).toBe("refuse");
    expect(decision.message).toMatch(/uncommitted changes/);
  });

  test("--force overrides a stale commit", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: false,
      previousGeneratedFrom: "def456",
      currentCommit: "abc123",
      isAncestor: isAncestorOf({ def456: ["abc123"] }),
      force: true,
    });
    expect(decision.action).toBe("write");
  });

  test("--force overrides a dirty tree", () => {
    const decision = decidePaidLocaleKeysAction({
      paidExists: true,
      paidDirty: true,
      previousGeneratedFrom: "abc123",
      currentCommit: "abc123",
      isAncestor: isAncestorOf({}),
      force: true,
    });
    expect(decision.action).toBe("write");
  });
});

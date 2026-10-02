import { describe, expect, test } from "vitest";
import { checkPaidAgainstOriginMain, decidePaidLocaleKeysAction } from "../scripts/paid-locale-keys-lib.mjs";
import fs from "node:fs";
import path from "node:path";

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

/**
 * B2712 — i18n-keys.mjs also refuses when paid/'s HEAD never reached paid's
 * own origin/main, separately from decidePaidLocaleKeysAction's check
 * against the last generation.
 */
describe("checkPaidAgainstOriginMain", () => {
  const isAncestorOf =
    (ancestors: Record<string, string[]>) =>
    (ancestor: string, descendant: string) =>
      (ancestors[descendant] ?? []).includes(ancestor) || ancestor === descendant;

  test("no origin/main known locally — nothing to compare against, proceeds", () => {
    const result = checkPaidAgainstOriginMain({ headSha: "abc123", originMainSha: null });
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test("HEAD is origin/main — proceeds with no warning", () => {
    const result = checkPaidAgainstOriginMain({ headSha: "abc123", originMainSha: "abc123" });
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  test("HEAD is behind origin/main — proceeds, but warns", () => {
    const result = checkPaidAgainstOriginMain({
      headSha: "abc123",
      originMainSha: "def456",
      isAncestor: isAncestorOf({ def456: ["abc123"] }),
    });
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/behind origin\/main/);
  });

  test("HEAD holds a commit origin/main does not have — refuses", () => {
    const result = checkPaidAgainstOriginMain({
      headSha: "abc123",
      originMainSha: "def456",
      isAncestor: isAncestorOf({}),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not on paid origin\/main/);
    expect(result.message).toContain("abc123");
    expect(result.message).toContain("def456");
  });

  test("--force overrides an unmerged HEAD, but still warns", () => {
    const result = checkPaidAgainstOriginMain({
      headSha: "abc123",
      originMainSha: "def456",
      isAncestor: isAncestorOf({}),
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/--force/);
  });
});

/**
 * B2554 — lib/paidLocaleKeys.json is the public declaration of the strings
 * only paid/ reads. Public CI runs without paid/, so deleting one of them
 * from English used to pass here and fail only in the paid tests at the next
 * deploy. Every declared key has to stay in English.
 */
describe("every key paid/ is declared to read is still in English", () => {
  test("lib/paidLocaleKeys.json names no key site/locales/en.json lacks", () => {
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8"));
    const english = read("site/locales/en.json") as Record<string, string>;
    const declared = (read("lib/paidLocaleKeys.json") as { keys: string[] }).keys;
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((key) => typeof english[key] !== "string")).toEqual([]);
  });
});

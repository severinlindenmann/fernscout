import { describe, expect, test } from "vitest";
import { shouldUpgradeIdentity } from "@/lib/helper/pageState";

/**
 * B1492 — an owner signed in on their own journal was shown the code form
 * here, because this page asks for `fs_identity` and a browser can be fully
 * signed in with `fs_session` alone. The door now mounts B459's upgrade, and
 * this is the rule for when.
 */

describe("shouldUpgradeIdentity", () => {
  test("a journal cookie and no identity — the reported bug — asks for the upgrade", () => {
    expect(shouldUpgradeIdentity(null, "a-journal-token")).toBe(true);
  });

  test("a genuine stranger at the door fires nothing", () => {
    expect(shouldUpgradeIdentity(null, undefined)).toBe(false);
  });

  test("an identity already in hand asks for nothing", () => {
    expect(shouldUpgradeIdentity({ email: "her@example.test" }, "a-journal-token")).toBe(false);
  });
});

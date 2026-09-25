import { describe, expect, test } from "vitest";
import { reviewLoginCode } from "@/lib/auth/reviewLogin";

/**
 * App Review's one fixed code — B2125. The whole point is what it refuses,
 * so most of this is refusals; the environment is passed in, never read, so
 * nothing here depends on the shell the suite runs in.
 */
const env = { email: "review@example.test", code: "123456", admin: false };

describe("reviewLoginCode", () => {
  test("the reviewer address gets the fixed code for an identity sign-in", () => {
    expect(reviewLoginCode("review@example.test", null, ["test-appreview"], env)).toBe("123456");
  });

  test("case and whitespace in the address do not matter", () => {
    expect(reviewLoginCode("  Review@Example.TEST ", null, ["test-appreview"], env)).toBe("123456");
  });

  test("any other address gets nothing, whatever it owns", () => {
    expect(reviewLoginCode("owner@example.test", null, ["test-appreview"], env)).toBeNull();
  });

  test("a code asked for a real journal is never fixed", () => {
    expect(reviewLoginCode("review@example.test", "example", ["test-appreview"], env)).toBeNull();
  });

  test("a code asked for the test journal the address owns is fixed", () => {
    expect(reviewLoginCode("review@example.test", "test-appreview", ["test-appreview"], env)).toBe("123456");
  });

  test("a code asked for a test journal the address does not own is not", () => {
    expect(reviewLoginCode("review@example.test", "test-other", ["test-appreview"], env)).toBeNull();
  });

  test("before the address owns a test journal there is no fixed code, not even for identity or signup", () => {
    expect(reviewLoginCode("review@example.test", null, [], env)).toBeNull();
  });

  test("owning one real journal refuses the fixed code entirely", () => {
    expect(reviewLoginCode("review@example.test", null, ["test-appreview", "alex"], env)).toBeNull();
  });

  test("the admin address is never the reviewer", () => {
    expect(reviewLoginCode("review@example.test", null, ["test-appreview"], { ...env, admin: true })).toBeNull();
  });

  test("unset, half set, or a code that is not six digits: nothing", () => {
    const owned = ["test-appreview"];
    expect(reviewLoginCode("review@example.test", null, owned, { admin: false })).toBeNull();
    expect(reviewLoginCode("review@example.test", null, owned, { ...env, code: undefined })).toBeNull();
    expect(reviewLoginCode("review@example.test", null, owned, { ...env, code: "12345" })).toBeNull();
    expect(reviewLoginCode("review@example.test", null, owned, { ...env, code: "abcdef" })).toBeNull();
  });
});

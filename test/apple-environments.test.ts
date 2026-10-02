import { afterEach, describe, expect, test } from "vitest";
import { appleEnvironmentAllowed, isTestJournal } from "@/lib/apple/environments";

/**
 * B2699 — Apple's own App Review buys in-app purchases in the Sandbox
 * environment against the production server, so an instance whose
 * `APPLE_ENVIRONMENTS` is Production only still has to accept a Sandbox
 * transaction when it can only ever unlock a `test-*` journal's own grant.
 * Everything else keeps the old, closed-by-default shape.
 */

afterEach(() => {
  delete process.env.APPLE_ENVIRONMENTS;
});

describe("isTestJournal", () => {
  test("a test-* journal name matches, a real one and an unresolved journal do not", () => {
    expect(isTestJournal("test-appreview")).toBe(true);
    expect(isTestJournal("ana")).toBe(false);
    expect(isTestJournal(null)).toBe(false);
    expect(isTestJournal(undefined)).toBe(false);
  });
});

describe("appleEnvironmentAllowed", () => {
  test("Production is accepted by default for a real journal and a test journal alike", () => {
    expect(appleEnvironmentAllowed("Production", "ana")).toBe(true);
    expect(appleEnvironmentAllowed("Production", "test-appreview")).toBe(true);
  });

  test("Sandbox is refused by default for a real journal", () => {
    expect(appleEnvironmentAllowed("Sandbox", "ana")).toBe(false);
  });

  test("Sandbox is accepted by default for a test-* journal", () => {
    expect(appleEnvironmentAllowed("Sandbox", "test-appreview")).toBe(true);
  });

  test("Sandbox is refused when the journal cannot be resolved at all", () => {
    expect(appleEnvironmentAllowed("Sandbox", null)).toBe(false);
  });

  test("Xcode is refused for a test journal unless the instance already allows it", () => {
    expect(appleEnvironmentAllowed("Xcode", "test-appreview")).toBe(false);
    process.env.APPLE_ENVIRONMENTS = "Production,Sandbox,Xcode";
    expect(appleEnvironmentAllowed("Xcode", "test-appreview")).toBe(true);
  });

  test("APPLE_ENVIRONMENTS widening Sandbox for everyone still works regardless of the journal", () => {
    process.env.APPLE_ENVIRONMENTS = "Production,Sandbox";
    expect(appleEnvironmentAllowed("Sandbox", "ana")).toBe(true);
  });
});

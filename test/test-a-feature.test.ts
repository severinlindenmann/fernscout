import { describe, expect, test } from "vitest";
import { resolveFlows } from "@/scripts/test-a-feature";

describe("resolveFlows", () => {
  test("returns the flows a covered capability names", () => {
    const result = resolveFlows("helper");
    expect(result.flows).toEqual(["buddy-established-add-day-agent"]);
    expect(result.note).toBeUndefined();
  });

  test("returns no flows and a note for a todo capability", () => {
    const result = resolveFlows("postcards");
    expect(result.flows).toEqual([]);
    expect(result.note).toMatch(/no flow yet/i);
  });

  test("throws for a capability name that does not exist", () => {
    expect(() => resolveFlows("acme" as never)).toThrow(/unknown capability/i);
  });
});

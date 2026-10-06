import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * B-2928 — "not said" (8 characters) was written as a day's
 * `declined.transportMode` at publish time, and every later read of the trip
 * refused it (a decline carries at least 10 characters). Derived from the
 * file's own table so a new reason cannot drift under the floor.
 */
describe("publish-time decline reasons", () => {
  test("every reason clears the schema's decline floor", async () => {
    const { declineReason } = await import("@/lib/api/v2/schemas/shared");
    const { REASONS, publishBlankReasonFor } = await import("@/lib/studio/publishBlankReasons");
    const all = [
      ...Object.entries(REASONS),
      ["weather (place)", publishBlankReasonFor("weather", { location: "x" })],
      ["weather (no place)", publishBlankReasonFor("weather", {})],
    ];
    for (const [field, reason] of all) {
      expect(declineReason.safeParse(reason).success, `${field}: ${JSON.stringify(reason)}`).toBe(true);
    }
  });
});

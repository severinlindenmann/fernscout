import { describe, expect, test } from "vitest";
import { tripFromJson } from "@/lib/api/v2/documents";
import { tripDoc } from "@/lib/api/v2/schemas";

/**
 * B-2928 — `declined.buddies` was a question until B2297 removed it, and
 * trips written before that still carry it. The strict `declined` schema
 * refused it as an unrecognised key on every full read, so editing any of
 * those trips answered 422 (500 before B-2928's first fix).
 */
describe("a trip.json that still declines the retired buddies question", () => {
  const raw = JSON.stringify({
    id: "old-trip",
    title: "Old trip",
    dates: { from: "2025-05-01", to: "2025-05-04" },
    visibility: "private",
    people: [{ name: "Tess Traveller", email: "tess@example.test" }],
    declined: {
      rates: "this trip's figures only ever use the journal's own currency",
      buddies: "not entered during setup",
    },
  });

  test("reads without it", () => {
    const trip = tripFromJson(raw);
    expect(trip.declined).toEqual({ rates: "this trip's figures only ever use the journal's own currency" });
  });

  test("the read trip passes the full document schema's declined map", () => {
    const trip = tripFromJson(raw);
    const parsed = tripDoc.shape.declined.safeParse(trip.declined);
    expect(parsed.success).toBe(true);
  });

  test("a trip whose only decline was buddies reads with no declined map at all", () => {
    const only = JSON.stringify({ ...JSON.parse(raw), declined: { buddies: "not entered during setup" } });
    expect(tripFromJson(only).declined).toBeUndefined();
  });
});

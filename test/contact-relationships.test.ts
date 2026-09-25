import { describe, expect, test } from "vitest";
import { relationshipsFor } from "@/lib/contacts/relationships";

/**
 * B630 — the pure derivation behind the contacts page's own tag: owner,
 * buddy (per trip) and guest are read from what already decides them
 * (`owner.email`, `peopleOf()`, the live read grant) rather than stored, and
 * a person can be more than one at once.
 */
describe("relationshipsFor", () => {
  const trips = [
    { id: "alps-2024", title: "The Alps", people: ["kevin@example.test"] },
    { id: "asia-2025", title: "Asia 2025", people: ["kevin@example.test", "owner@example.test"] },
  ];

  test("the owner", () => {
    const result = relationshipsFor("Owner@Example.Test", "owner@example.test", trips, false);
    expect(result.owner).toBe(true);
    expect(result.guest).toBe(false);
    // Also on `people:` for the second trip, and it says so.
    expect(result.buddyOf).toEqual([{ id: "asia-2025", title: "Asia 2025" }]);
  });

  test("a buddy on one trip", () => {
    const result = relationshipsFor("kevin@example.test", "owner@example.test", [trips[0]], false);
    expect(result).toEqual({
      owner: false,
      guest: false,
      buddyOf: [{ id: "alps-2024", title: "The Alps" }],
    });
  });

  test("a buddy on more than one trip", () => {
    const result = relationshipsFor("kevin@example.test", "owner@example.test", trips, false);
    expect(result.buddyOf).toEqual([
      { id: "alps-2024", title: "The Alps" },
      { id: "asia-2025", title: "Asia 2025" },
    ]);
  });

  test("a guest, and nothing else", () => {
    const result = relationshipsFor("gran@example.test", "owner@example.test", trips, true);
    expect(result).toEqual({ owner: false, guest: true, buddyOf: [] });
  });

  test("two at once, both said rather than one picked", () => {
    const result = relationshipsFor("kevin@example.test", "owner@example.test", trips, true);
    expect(result.guest).toBe(true);
    expect(result.buddyOf).toHaveLength(2);
  });

  test("no journal owner address configured names nobody the owner", () => {
    const result = relationshipsFor("kevin@example.test", null, trips, false);
    expect(result.owner).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { readerState, splitReaders } from "@/lib/readers/split";

/**
 * B2296 — an imported row ("who was there") is its own group, "Not invited
 * yet", never folded into "waiting for them": that name means an invite
 * already went out, and an import never sent one.
 */
describe("readerState — notInvited", () => {
  test("an imported, unconfirmed row is notInvited, not waitingOnThem", () => {
    expect(
      readerState({ email: "a@example.test", status: "pending", confirmedAt: null, createdVia: "owner-import" }),
    ).toBe("notInvited");
  });

  test("an invited, unconfirmed row is still waitingOnThem", () => {
    expect(
      readerState({ email: "a@example.test", status: "pending", confirmedAt: null, createdVia: "invite:abc" }),
    ).toBe("waitingOnThem");
  });

  test("a confirmed import is waitingOnYou, same as any other confirmed row", () => {
    expect(
      readerState({
        email: "a@example.test",
        status: "pending",
        confirmedAt: "2026-01-01T00:00:00.000Z",
        createdVia: "owner-import",
      }),
    ).toBe("waitingOnYou");
  });

  test("splitReaders groups imported rows under notInvited", () => {
    const rows = [
      { email: "imported@example.test", status: "pending" as const, confirmedAt: null, createdVia: "owner-import" },
      { email: "invited@example.test", status: "pending" as const, confirmedAt: null, createdVia: "invite:abc" },
    ];
    const split = splitReaders(rows, null);
    expect(split.notInvited.map((r) => r.email)).toEqual(["imported@example.test"]);
    expect(split.waitingOnThem.map((r) => r.email)).toEqual(["invited@example.test"]);
  });
});

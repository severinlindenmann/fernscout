import { describe, expect, test } from "vitest";
import { matchItems } from "@/app/admin/Palette";
import { threadsOf, type SmsRow } from "@/app/admin/SmsThreads";

describe("the ⌘K palette", () => {
  const items = [
    { label: "Overview", hint: "Section", hash: "overview" },
    { label: "test-alps", hint: "Journal", hash: "journals/test-alps" },
    { label: "test-balkan", hint: "Journal", hash: "journals/test-balkan" },
  ];

  test("every typed word must match, in any order, ignoring case", () => {
    expect(matchItems(items, "ALPS").map((one) => one.hash)).toEqual(["journals/test-alps"]);
    expect(matchItems(items, "journal balkan").map((one) => one.hash)).toEqual(["journals/test-balkan"]);
    expect(matchItems(items, "nothing like it")).toEqual([]);
  });

  test("an empty query offers the first few rather than nothing", () => {
    expect(matchItems(items, "  ")).toHaveLength(3);
  });
});

describe("SMS as conversations", () => {
  const row = (id: string, direction: "in" | "out", other: string, at: string): SmsRow => ({
    id,
    direction,
    from: direction === "in" ? other : "41000",
    to: direction === "in" ? "41000" : other,
    body: id,
    dryRun: false,
    createdAt: at,
  });

  test("groups by the number at the other end, newest conversation first, oldest message first", () => {
    const threads = threadsOf([
      row("a2", "out", "41111", "2026-09-02T00:00:00Z"),
      row("b1", "in", "36222", "2026-09-03T00:00:00Z"),
      row("a1", "in", "41111", "2026-09-01T00:00:00Z"),
    ]);
    expect(threads.map((one) => one.number)).toEqual(["36222", "41111"]);
    expect(threads[1].messages.map((one) => one.id)).toEqual(["a1", "a2"]);
  });
});

import { expect, test } from "vitest";
import { hiddenLabelDays, type LabelBox } from "@/lib/map/streetOverlay";

/** B2560 — a marker's label hides when it would overlap an earlier-placed
 * one; the disc itself is drawn regardless (this pure helper only ever
 * decides labels, never discs — `streetOverlay.ts`'s own draw loop is what
 * keeps the disc unconditional). */

test("keeps every label when none overlap", () => {
  const boxes: LabelBox[] = [
    { day: 1, x: 0, y: 0, width: 40, height: 22 },
    { day: 2, x: 200, y: 0, width: 40, height: 22 },
  ];
  expect(hiddenLabelDays(boxes)).toEqual(new Set());
});

test("hides a later label that overlaps an earlier one", () => {
  const boxes: LabelBox[] = [
    { day: 1, x: 0, y: 0, width: 40, height: 22 },
    { day: 2, x: 20, y: 5, width: 40, height: 22 }, // overlaps day 1's box
    { day: 3, x: 500, y: 0, width: 40, height: 22 }, // clear of both
  ];
  expect(hiddenLabelDays(boxes)).toEqual(new Set([2]));
});

test("placement order decides who wins — the selected day goes first", () => {
  // Two colliding boxes for days 5 and 1: whichever is listed first (the
  // caller's job to put the selected day there) keeps its label.
  const selectedFirst: LabelBox[] = [
    { day: 5, x: 0, y: 0, width: 40, height: 22 },
    { day: 1, x: 10, y: 0, width: 40, height: 22 },
  ];
  expect(hiddenLabelDays(selectedFirst)).toEqual(new Set([1]));

  const dayOrderFirst: LabelBox[] = [
    { day: 1, x: 10, y: 0, width: 40, height: 22 },
    { day: 5, x: 0, y: 0, width: 40, height: 22 },
  ];
  expect(hiddenLabelDays(dayOrderFirst)).toEqual(new Set([5]));
});

test("a third label can collide with either of the first two already placed", () => {
  const boxes: LabelBox[] = [
    { day: 1, x: 0, y: 0, width: 30, height: 22 },
    { day: 2, x: 100, y: 0, width: 30, height: 22 },
    { day: 3, x: 105, y: 5, width: 30, height: 22 }, // overlaps day 2, not day 1
  ];
  expect(hiddenLabelDays(boxes)).toEqual(new Set([3]));
});

import { expect, test } from "vitest";
import { groupByScreen } from "@/lib/map/pinGroups";

test("pins closer than the threshold share a group, far ones do not", () => {
  const g = groupByScreen([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 0 }], 40);
  expect(g.map((x) => x.length)).toEqual([2, 1]);
});

test("exactly the threshold apart stays separate", () => {
  expect(groupByScreen([{ x: 0, y: 0 }, { x: 40, y: 0 }], 40)).toHaveLength(2);
});

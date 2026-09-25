import { describe, expect, test } from "vitest";
import { moveFigureInSet } from "@/lib/figures/order";

describe("moveFigureInSet", () => {
  const ids = ["a", "b", "c"];

  test("moves an id up, swapping with its neighbour", () => {
    expect(moveFigureInSet(ids, "b", "up")).toEqual(["b", "a", "c"]);
  });

  test("moves an id down", () => {
    expect(moveFigureInSet(ids, "b", "down")).toEqual(["a", "c", "b"]);
  });

  test("the first id cannot move up — the list is unchanged", () => {
    expect(moveFigureInSet(ids, "a", "up")).toEqual(["a", "b", "c"]);
  });

  test("the last id cannot move down — the list is unchanged", () => {
    expect(moveFigureInSet(ids, "c", "down")).toEqual(["a", "b", "c"]);
  });

  test("an id not in the list is returned unchanged", () => {
    expect(moveFigureInSet(ids, "z", "up")).toEqual(["a", "b", "c"]);
  });

  test("never mutates the input array", () => {
    const original = ["a", "b", "c"];
    moveFigureInSet(original, "b", "up");
    expect(original).toEqual(["a", "b", "c"]);
  });
});

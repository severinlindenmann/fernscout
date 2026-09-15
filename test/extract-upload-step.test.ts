import { describe, expect, test } from "vitest";
import { chunk, failedIndices } from "@/components/extract/UploadStep";

/**
 * The two pure reads `UploadStep` builds its per-file guarantee on — B1751,
 * Task 1.3. Neither touches the DOM, so they are checked here rather than
 * only by driving the whole component.
 */
describe("chunk", () => {
  test("groups indices into batches of the given size", () => {
    expect(chunk([0, 1, 2, 3, 4], 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  test("one batch when everything fits", () => {
    expect(chunk([0, 1, 2], 10)).toEqual([[0, 1, 2]]);
  });

  test("empty input makes no batches", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("failedIndices", () => {
  test("finds only the failed tiles, in order, and none of a succeeded batch's", () => {
    const tiles = [
      { file: new File([], "a.jpg"), state: "done" as const },
      { file: new File([], "b.jpg"), state: "failed" as const },
      { file: new File([], "c.jpg"), state: "sending" as const },
      { file: new File([], "d.jpg"), state: "failed" as const },
    ];
    expect(failedIndices(tiles)).toEqual([1, 3]);
  });

  test("empty when nothing failed", () => {
    const tiles = [{ file: new File([], "a.jpg"), state: "done" as const }];
    expect(failedIndices(tiles)).toEqual([]);
  });
});

/**
 * `ExtractFlow` decides an attempt is "done" — safe to show the summary and
 * drop the retry button — exactly when it has nothing left to retry. This is
 * the review fix for Task 1.3: `UploadStep.onDone` used to be treated as
 * terminal on every call, success or partial failure, which made the retry
 * button disappear the moment somebody actually needed it. The decision is
 * `failedIndices(tiles).length === 0`, checked here directly rather than only
 * through `ExtractFlow`'s own JSX.
 */
describe("whether an attempt is done", () => {
  test("a run with outstanding failures is not done", () => {
    const tiles = [
      { file: new File([], "a.jpg"), state: "done" as const },
      { file: new File([], "b.jpg"), state: "failed" as const },
    ];
    expect(failedIndices(tiles).length === 0).toBe(false);
  });

  test("a run with nothing failed is done", () => {
    const tiles = [
      { file: new File([], "a.jpg"), state: "done" as const },
      { file: new File([], "b.jpg"), state: "done" as const },
    ];
    expect(failedIndices(tiles).length === 0).toBe(true);
  });
});

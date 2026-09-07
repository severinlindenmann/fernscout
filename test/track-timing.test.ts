import { describe, expect, test } from "vitest";
import { TRACK_ROWS } from "@/lib/tracks";

/**
 * B709 asked whether the money question belongs at write or at publish, and a
 * person decided: it stays at `write`, in step with `coordinates`.
 *
 * These are not tests of behaviour — `missingFrom` is covered elsewhere. They
 * pin the *decision*, so that moving a row's timing is a deliberate act with a
 * failing test in front of it rather than a one-character edit nobody notices.
 * The reasoning itself is in `lib/tracks.ts` beside the row, which is where
 * the ticket's acceptance asked for it.
 */
describe("when each track asks its question — B709", () => {
  test("costs is asked at write, and says so in step with coordinates", () => {
    expect(TRACK_ROWS.costs.when).toBe("write");
    expect(TRACK_ROWS.costs.when).toBe(TRACK_ROWS.coordinates.when);
  });

  test("photos is asked at publish, because there is none to report at write", () => {
    expect(TRACK_ROWS.photos.when).toBe("publish");
  });

  test("every row's decline and unknown answers are distinct sentences", () => {
    // The third answer (B560) only earns its place if it says something the
    // refusal does not; two rows sharing a sentence would mean one of them is
    // telling the reader nothing.
    for (const [name, row] of Object.entries(TRACK_ROWS)) {
      expect(row.decline, `${name}.decline`).not.toBe(row.unknown);
      expect(row.decline.length, `${name}.decline`).toBeGreaterThan(0);
      expect(row.unknown.length, `${name}.unknown`).toBeGreaterThan(0);
    }
  });
});

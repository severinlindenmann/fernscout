import { describe, expect, test } from "vitest";
import { committedDays, skippedGroups } from "@/components/extract/PreviewScreen";
import type { DayGroup } from "@/lib/extract/group";
import type { RunManifest } from "@/lib/staging/manifest";

/**
 * `PreviewScreen`'s two pure reads — B1751 Task 4.2. Neither touches the DOM,
 * so they are checked here rather than only by driving the whole component,
 * same shape `UploadStep`'s `chunk`/`failedIndices` already use.
 */
function manifest(days: RunManifest["days"]): RunManifest {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: "trip-1",
    mode: "type",
    state: "telling",
    photos: [],
    days,
  };
}

function group(date: string, undated = false): DayGroup {
  return { date, photoIds: ["p1"], undated };
}

describe("committedDays", () => {
  test("keeps only rows that are both committed and carry a real slug", () => {
    const m = manifest([
      { date: "2026-06-01", answered: [], committed: true, entrySlug: "first-day" },
      { date: "2026-06-02", answered: [], committed: false },
      // Should never happen (commit.ts always sets both together) but a row
      // missing the slug still must not be treated as linkable.
      { date: "2026-06-03", answered: [], committed: true },
    ]);
    expect(committedDays(m)).toEqual([
      { date: "2026-06-01", answered: [], committed: true, entrySlug: "first-day" },
    ]);
  });

  test("a run with nothing committed yet names none", () => {
    const m = manifest([{ date: "2026-06-01", answered: ["q1"], committed: false }]);
    expect(committedDays(m)).toEqual([]);
  });
});

describe("skippedGroups", () => {
  test("a dated group with no committed row is skipped", () => {
    const m = manifest([{ date: "2026-06-01", answered: [], committed: true, entrySlug: "first-day" }]);
    const groups = [group("2026-06-01"), group("2026-06-02")];
    expect(skippedGroups(m, groups)).toEqual([group("2026-06-02")]);
  });

  test("the undated group is never counted as skipped here — it has its own count", () => {
    const m = manifest([]);
    const groups = [group("2026-06-01"), group("undated", true)];
    expect(skippedGroups(m, groups)).toEqual([group("2026-06-01")]);
  });

  test("every dated group committed leaves nothing skipped", () => {
    const m = manifest([{ date: "2026-06-01", answered: [], committed: true, entrySlug: "first-day" }]);
    expect(skippedGroups(m, [group("2026-06-01")])).toEqual([]);
  });
});

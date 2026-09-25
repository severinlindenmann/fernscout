import { describe, expect, test } from "vitest";
import { beforeTripNoticeTime, nextOpenEndedReminder, stopNoticeTime, tripsNeedingBeforeNotice } from "@/lib/gps/notify";

/** B2197 — the pure date math behind the hub's before-trip and stop
 *  notices, kept apart from the shell-only effect so it needs no device
 *  clock, no simulator and no @capacitor/local-notifications to test. */

describe("beforeTripNoticeTime", () => {
  test("18:00 the evening before start, well ahead of it", () => {
    const now = new Date(2026, 8, 20, 9, 0, 0).getTime(); // Sep 20, 09:00
    const at = beforeTripNoticeTime(now, { start: "2026-09-25" });
    expect(new Date(at!)).toEqual(new Date(2026, 8, 24, 18, 0, 0));
  });

  test("3 hours from now when 18:00 the evening before has already passed and the trip has not started", () => {
    const now = new Date(2026, 8, 24, 20, 0, 0).getTime(); // Sep 24, 20:00 — past 18:00
    const at = beforeTripNoticeTime(now, { start: "2026-09-25" });
    expect(at).toBe(now + 3 * 60 * 60 * 1000);
  });

  test("null once the trip has started", () => {
    const now = new Date(2026, 8, 25, 0, 0, 0).getTime();
    expect(beforeTripNoticeTime(now, { start: "2026-09-25" })).toBeNull();
  });

  test("null for an unparseable date", () => {
    expect(beforeTripNoticeTime(Date.now(), { start: "not-a-date" })).toBeNull();
  });
});

describe("stopNoticeTime", () => {
  test("local midnight two days after the trip's last day — D2's cooldown", () => {
    const at = stopNoticeTime({ end: "2026-09-30" });
    expect(new Date(at)).toEqual(new Date(2026, 9, 2, 0, 0, 0));
  });
});

describe("nextOpenEndedReminder", () => {
  test("every 7 days from when open-ended started", () => {
    const since = new Date(2026, 8, 1).getTime();
    expect(nextOpenEndedReminder(since, since)).toBe(since + 7 * 24 * 60 * 60 * 1000);
    const midway = since + 10 * 24 * 60 * 60 * 1000; // 10 days in — one reminder already due
    expect(nextOpenEndedReminder(since, midway)).toBe(since + 14 * 24 * 60 * 60 * 1000);
  });
});

describe("tripsNeedingBeforeNotice", () => {
  const now = new Date(2026, 8, 20).getTime();
  const trips = [
    { id: "a", title: "A", start: "2026-09-25", end: "2026-09-28" }, // future, needs one
    { id: "b", title: "B", start: "2026-09-01", end: "2026-09-05" }, // already started
    { id: "c", title: "C", start: "2026-10-01", end: "2026-10-05" }, // armed
    { id: "d", title: "D", start: "2026-10-10", end: "2026-10-12" }, // declined
  ];

  test("only future trips that are neither armed nor declined", () => {
    const due = tripsNeedingBeforeNotice(now, trips, new Set(["c", "d"]));
    expect(due.map((t) => t.id)).toEqual(["a"]);
  });

  test("a deleted or already-started trip drops off the next time this is computed", () => {
    const due = tripsNeedingBeforeNotice(now, trips.filter((t) => t.id !== "a"), new Set());
    expect(due.map((t) => t.id)).toEqual(["c", "d"]);
  });
});

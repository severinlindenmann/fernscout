import { describe, expect, it } from "vitest";
import {
  PIN_NEAR_KM,
  addDays,
  findGaps,
  looksLikeStay,
  moveStop,
  nearestStopIndex,
  nearestStopWithin,
  previewNightsSchedule,
  sequenceContext,
  type ScheduleStop,
} from "@/lib/planner/schedule";

describe("previewNightsSchedule", () => {
  it("derives arrive/leave from the trip start, order and nights", () => {
    const route: ScheduleStop[] = [
      { location: "Bangkok", nights: 3 },
      { location: "Chiang Mai", nights: 5 },
      { location: "Luang Prabang" },
    ];
    const out = previewNightsSchedule(route, "2027-02-12");
    expect(out[0]).toMatchObject({ arrive: "2027-02-12", leave: "2027-02-15" });
    expect(out[1]).toMatchObject({ arrive: "2027-02-15", leave: "2027-02-20" });
    // No nights → arrive carries forward, leave is undetermined.
    expect(out[2].arrive).toBe("2027-02-20");
    expect(out[2].leave).toBeUndefined();
  });

  it("matches the server's own derivation for an inserted stop (the ticket's own scenario)", () => {
    // Chiang Mai → Chiang Rai (new, 2 nights) → Luang Prabang
    const route: ScheduleStop[] = [
      { location: "Chiang Mai", nights: 5 },
      { location: "Chiang Rai", nights: 2 },
      { location: "Luang Prabang" },
    ];
    const out = previewNightsSchedule(route, "2027-02-15");
    expect(out[1]).toMatchObject({ arrive: "2027-02-20", leave: "2027-02-22" });
    expect(out[2].arrive).toBe("2027-02-22");
  });

  it("stops propagating once a later stop has no leave to hand on", () => {
    const route: ScheduleStop[] = [{ location: "A" }, { location: "B", nights: 2 }];
    const out = previewNightsSchedule(route, "2027-01-01");
    expect(out[0].arrive).toBe("2027-01-01");
    expect(out[0].leave).toBeUndefined();
    expect(out[1].arrive).toBeUndefined();
  });
});

describe("addDays", () => {
  it("adds whole days across a month boundary", () => {
    expect(addDays("2027-02-27", 3)).toBe("2027-03-02");
  });
});

describe("moveStop", () => {
  it("reorders by index", () => {
    const route = ["a", "b", "c", "d"];
    expect(moveStop(route, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("is a no-op out of range", () => {
    const route = ["a", "b"];
    expect(moveStop(route, 0, 5)).toEqual(route);
  });
});

describe("sequenceContext", () => {
  it("names the stop before and after an insertion point", () => {
    const route = [{ location: "Chiang Mai" }, { location: "Luang Prabang" }];
    expect(sequenceContext(route, 1)).toEqual({ before: "Chiang Mai", after: "Luang Prabang" });
    expect(sequenceContext(route, 0)).toEqual({ before: null, after: "Chiang Mai" });
    expect(sequenceContext(route, 2)).toEqual({ before: "Luang Prabang", after: null });
  });
});

describe("nearestStopWithin / nearestStopIndex", () => {
  const route = [
    { location: "Luang Prabang", lat: 19.8856, lng: 102.1347 },
    { location: "Bangkok", lat: 13.7563, lng: 100.5018 },
  ];
  it("finds a stop within the same-town threshold", () => {
    // Wat Xieng Thong, genuinely inside Luang Prabang.
    const hit = nearestStopWithin(route, { lat: 19.8965, lng: 102.144 });
    expect(hit?.location).toBe("Luang Prabang");
  });
  it("finds nothing far from every stop", () => {
    expect(nearestStopWithin(route, { lat: 48.8566, lng: 2.3522 })).toBeNull();
  });
  it("names the geographically nearest stop for a brand-new town", () => {
    // Chiang Rai — closer to Luang Prabang's index (0) than to Bangkok's (1).
    expect(nearestStopIndex(route, { lat: 19.9105, lng: 99.8406 })).toBe(0);
  });

  // B2014 — a WhatsApp pin is a rough drop, not a typed search, and offers
  // "a visit in X" from farther away than a typed place would.
  it("PIN_NEAR_KM finds a pin the same-town default misses", () => {
    // ~50km from Bangkok: outside the default same-town threshold, inside
    // the wider one pins get.
    const farPin = { lat: 14.2, lng: 100.6 };
    expect(nearestStopWithin(route, farPin)).toBeNull();
    expect(nearestStopWithin(route, farPin, PIN_NEAR_KM)?.location).toBe("Bangkok");
  });
});

describe("findGaps", () => {
  it("names a date nobody's stay covers", () => {
    const route = [
      { arrive: "2027-02-12", leave: "2027-02-15" },
      { arrive: "2027-02-16", leave: "2027-02-20" },
    ];
    expect(findGaps(route)).toEqual(["2027-02-15"]);
  });
  it("reports nothing when the chain is continuous", () => {
    const route = [
      { arrive: "2027-02-12", leave: "2027-02-15" },
      { arrive: "2027-02-15", leave: "2027-02-20" },
    ];
    expect(findGaps(route)).toEqual([]);
  });
  it("ignores an open-ended stop rather than calling it a gap", () => {
    const route = [{ arrive: "2027-02-12", leave: undefined }, { arrive: undefined, leave: undefined }];
    expect(findGaps(route)).toEqual([]);
  });
});

describe("looksLikeStay", () => {
  it("flags a hotel-shaped name", () => {
    expect(looksLikeStay("Hotel Kanra Kyoto")).toBe(true);
    expect(looksLikeStay("Ibis Riverside Hostel")).toBe(true);
  });
  it("leaves an ordinary place alone", () => {
    expect(looksLikeStay("Wat Xieng Thong")).toBe(false);
  });
});

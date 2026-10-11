import { describe, expect, it } from "vitest";
import { adjacentDate, haversineKm, planCamera, viewTravels } from "@/lib/map/dayTransition";

describe("adjacentDate", () => {
  const dates = ["2026-05-01", "2026-05-02", "2026-05-04"];
  it("steps through the days in order", () => {
    expect(adjacentDate(dates, "2026-05-01", 1)).toBe("2026-05-02");
    expect(adjacentDate(dates, "2026-05-04", -1)).toBe("2026-05-02");
  });
  it("stops at both ends and for an unknown or missing date", () => {
    expect(adjacentDate(dates, "2026-05-01", -1)).toBeNull();
    expect(adjacentDate(dates, "2026-05-04", 1)).toBeNull();
    expect(adjacentDate(dates, "2026-06-01", 1)).toBeNull();
    expect(adjacentDate(dates, null, 1)).toBeNull();
  });
});

describe("planCamera", () => {
  it("does not animate under reduced motion", () => {
    expect(planCamera({ km: 3000, flight: true, reduced: true })).toEqual({ kind: "jump" });
  });
  it("hops in 700-900ms", () => {
    const near = planCamera({ km: 0, flight: false, reduced: false });
    const far = planCamera({ km: 599, flight: false, reduced: false });
    expect(near).toEqual({ kind: "hop", duration: 700 });
    expect(far.kind === "hop" && far.duration).toBeLessThanOrEqual(900);
  });
  it("flies slower and higher for a declared flight or a leg over 600 km", () => {
    const declared = planCamera({ km: 50, flight: true, reduced: false });
    const long = planCamera({ km: haversineKm({ lat: 47.4, lng: 8.5 }, { lat: 64.1, lng: -21.9 }), flight: false, reduced: false });
    for (const plan of [declared, long]) {
      expect(plan.kind).toBe("flight");
      expect(plan.kind === "flight" && plan.duration).toBeGreaterThan(1500);
      expect(plan.kind === "flight" && plan.curve).toBeGreaterThan(1.42);
    }
  });
});

describe("haversineKm", () => {
  it("measures Zurich to Bern at about 95 km", () => {
    const km = haversineKm({ lat: 47.3769, lng: 8.5417 }, { lat: 46.948, lng: 7.4474 });
    expect(km).toBeGreaterThan(85);
    expect(km).toBeLessThan(105);
  });
});

describe("viewTravels (B-2980)", () => {
  it("travels when the overview changes on a map that already had one, and no day is selected", () => {
    expect(viewTravels("r|3,4", "r|1", null)).toBe(true);
    expect(viewTravels("r|3,4", "w|1,3,4", null)).toBe(true);
    expect(viewTravels("remount", "r|1", null)).toBe(true);
  });
  it("frames in place on the first view, an unchanged view, or with a day selected", () => {
    expect(viewTravels(undefined, "r|1", null)).toBe(false);
    expect(viewTravels("r|1", "r|1", null)).toBe(false);
    expect(viewTravels("r|3,4", "r|1", 3)).toBe(false);
  });
  it("Zurich to Bangkok flies the high slow arc", () => {
    const km = haversineKm({ lat: 47.37, lng: 8.54 }, { lat: 13.75, lng: 100.5 });
    expect(planCamera({ km, flight: true, reduced: false })).toMatchObject({ kind: "flight", curve: 1.9 });
    expect(planCamera({ km, flight: true, reduced: true })).toEqual({ kind: "jump" });
  });
});

describe("whole-trip deselect (B-2980)", () => {
  it("removes or sets ?day and keeps other params", async () => {
    const { withDayParam, nextSelection, escapeDeselects } = await import("@/lib/map/dayTransition");
    expect(withDayParam("?day=2026-08-02&show=1", null)).toBe("?show=1");
    expect(withDayParam("?day=2026-08-02", null)).toBe("");
    expect(withDayParam("", "2026-08-03")).toBe("?day=2026-08-03");
    expect(nextSelection("a", "a")).toBeNull();
    expect(nextSelection("a", "b")).toBe("b");
    expect(escapeDeselects("a", "Escape", false)).toBe(true);
    expect(escapeDeselects(null, "Escape", false)).toBe(false);
    expect(escapeDeselects("a", "Escape", true)).toBe(false);
    expect(escapeDeselects("a", "Enter", false)).toBe(false);
  });
});

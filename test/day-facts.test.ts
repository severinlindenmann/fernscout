import { describe, expect, it } from "vitest";
import { budgetFact, daySpend, formatKm, kmByDate, recordedKm, weatherFact } from "@/lib/map/dayFacts";

describe("day facts (B-2980)", () => {
  it("sums only recorded runs and says nothing for none", () => {
    expect(recordedKm([])).toBe(0);
    expect(formatKm(0)).toBeNull();
    const km = recordedKm([[[47, 8], [47.1, 8]], [[48, 9], [48, 9.1]]]);
    expect(km).toBeGreaterThan(17);
    expect(formatKm(km)).toMatch(/^\d+ km$/);
    expect(formatKm(2.345)).toBe("2.3 km");
  });

  it("states a stored reading with its source and invents nothing", () => {
    expect(weatherFact(undefined)).toBeNull();
    const f = weatherFact({ tempMin: 12, tempMax: 19, code: 0, source: "the balcony thermometer", recordedAt: "2026-08-26T17:00:00Z" });
    expect(f).toMatchObject({ group: "clear", temp: "12° – 19°C", source: "the balcony thermometer" });
    expect(weatherFact({ code: 999, source: "x", recordedAt: "2026-08-26T17:00:00Z" })).toBeNull();
    expect(weatherFact({ tempMax: 70, source: "open-meteo", recordedAt: "2026-08-26T17:00:00Z" }, "imperial")?.source).toBe("Open-Meteo");
  });

  it("budget needs a real figure", () => {
    const money = (n: number) => `CHF ${n}`;
    expect(budgetFact(undefined, undefined, money)).toBeNull();
    expect(budgetFact(0, 0, money)).toBeNull();
    expect(budgetFact(40, 900, money)).toEqual({ day: "CHF 40", trip: "CHF 900" });
    expect(budgetFact(undefined, 900, money)).toEqual({ day: undefined, trip: "CHF 900" });
  });

  it("attributes recorded runs to their date only", () => {
    const m = kmByDate([
      { date: "2026-08-01", points: [[47, 8], [47.1, 8]] },
      { date: "2026-08-01", points: [[47.1, 8], [47.2, 8]] },
      { points: [[1, 1], [2, 2]] },
    ]);
    expect([...m.keys()]).toEqual(["2026-08-01"]);
    expect(m.get("2026-08-01")).toBeGreaterThan(20);
  });
});

describe("day spend with mixed currencies (B-2980)", () => {
  const fmt = {
    money: (n: number) => `CHF ${n}`,
    original: (a: number, c: string) => `${c} ${a}`,
    single: "THB 450",
  };
  it("shows a single-currency day as it was paid", () => {
    expect(daySpend({ cost: 12 }, fmt)).toEqual({ text: "THB 450", converted: false });
  });
  it("marks a mixed-currency total as converted, never as one currency", () => {
    expect(daySpend({ cost: 60, costMixed: true }, fmt)).toEqual({ text: "≈ CHF 60", converted: true });
    expect(daySpend({ cost: 60, costMixed: true }, { ...fmt, money: (n) => `≈ CHF ${n}` })?.text).toBe("≈ CHF 60");
  });
  it("lists spend without a rate as paid, beside the total or alone", () => {
    const u = [{ currency: "XYZ", amount: 80 }];
    expect(daySpend({ cost: 60, costMixed: true, costUnconverted: u }, fmt)).toEqual({ text: "≈ CHF 60 + XYZ 80", converted: true });
    expect(daySpend({ costUnconverted: u }, fmt)).toEqual({ text: "XYZ 80", converted: false });
  });
  it("is null with no figure", () => {
    expect(daySpend({}, fmt)).toBeNull();
  });
});

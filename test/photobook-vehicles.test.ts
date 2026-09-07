import { describe, expect, it } from "vitest";
import { TRANSPORT_MODES } from "@/lib/validate/entry";
import {
  VEHICLE_BOX,
  vehicleBody,
  vehicleShapes,
  vehicleWheels,
  wheelShapes,
  type PrintableMode,
} from "@/lib/travel/vehicleShapes";
import { shapesToSvg } from "@/lib/travellers/render";
import { vehicleSvg } from "@/lib/photobook/vehicles";
import { planBook, type BookDay, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { renderVolume } from "@/lib/photobook/render";

/**
 * B737 — the travel scene's vehicles, drawn on paper.
 *
 * The point of the extraction is that there is one drawing and three
 * spellings of it. What a test can hold is the parts of that a person cannot
 * see by looking at one of them: that every mode a day may record has a
 * drawing, that both spellings actually emit one, and that a vehicle reaches
 * the page only when it was asked for.
 */

const MODES = Object.keys(VEHICLE_BOX) as PrintableMode[];

describe("every way of travelling has a drawing", () => {
  it("covers `TRANSPORT_MODES` exactly, less the one that has no vehicle", () => {
    // A new mode in `lib/validate/entry.ts` with no drawing here would be a
    // day the transport page quietly skips.
    expect(MODES.sort()).toEqual(
      TRANSPORT_MODES.filter((m) => m !== "walk")
        .slice()
        .sort(),
    );
  });

  it("draws a body and, where it has them, wheels standing on the baseline", () => {
    for (const mode of MODES) {
      expect(vehicleBody(mode).length, mode).toBeGreaterThan(0);
      for (const wheel of vehicleWheels(mode)) {
        // Wheels sit on the bottom edge of the box: the scene puts the
        // baseline where it likes and every mode has to agree where its own
        // is, or a car floats above the road.
        expect(Math.abs(wheel.cy + wheel.r - VEHICLE_BOX[mode].height), mode).toBeLessThan(3);
        expect(wheelShapes(wheel.r, wheel.look).length, mode).toBeGreaterThan(0);
      }
    }
  });

  it("spells the same shapes as SVG and as the book's own SVG", () => {
    for (const mode of MODES) {
      const shapes = vehicleShapes(mode);
      expect(shapes.length, mode).toBeGreaterThan(vehicleBody(mode).length - 1);
      // Both spellings draw every shape; the count of elements is the cheapest
      // thing that catches one of them dropping a kind it does not handle.
      const web = shapesToSvg(shapes).match(/<(path|rect|circle|ellipse)/g) ?? [];
      const book = vehicleSvg(mode, "0", "0", 20).match(/<(path|rect|circle|ellipse)/g) ?? [];
      expect(web.length, mode).toBe(book.length);
      expect(web.length, mode).toBeGreaterThan(3);
    }
  });

  it("a stroked circle keeps its stroke — the bicycle's rim is one", () => {
    const svg = shapesToSvg(wheelShapes(13, "spoked"));
    expect(svg).toContain("<circle");
    expect(svg).toMatch(/stroke="#/);
    expect(svg).toContain('fill="none"');
  });
});

describe("a vehicle reaches the transport page only when asked for", () => {
  const day = (i: number, mode: string): BookDay => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    title: `Day ${i + 1}`,
    location: "Somewhere",
    country: "Portugal",
    countryCode: "PT",
    lat: 37,
    lng: -8.7,
    paragraphs: ["A day."],
    photos: [],
    transport: { mode: mode as BookDay["transport"] extends undefined ? never : "car", from: "A", to: "B" },
  });

  const source: BookSource = {
    trip: { id: "t", title: "A trip", start: "2026-01-01", end: "2026-01-03", intro: "" },
    figures: [],
    travellers: ["A"],
    days: [day(0, "car"), day(1, "train"), day(2, "walk")],
    route: [],
    madeOn: "2026-09-07",
  };

  const shapesOf = (includeVehicles: boolean) => {
    const book = planBook(source, defaultSpec(), { ...DEFAULT_OPTIONS, includeVehicles });
    const page = book.volumes[0].pages.find((p) => p.kind === "transport");
    return page && page.kind === "transport" ? page.shapes : [];
  };

  it("off by default, and nothing on the page changes", () => {
    expect(shapesOf(false).some((s) => s.kind === "vehicle")).toBe(false);
  });

  it("on, one per mode that has a drawing — and none for walking", () => {
    const drawn = shapesOf(true).filter((s) => s.kind === "vehicle");
    expect(drawn.map((s) => (s.kind === "vehicle" ? s.mode : "")).sort()).toEqual(["car", "train"]);
  });

  it("the PDF actually paints them", () => {
    const withOut = renderVolume(
      planBook(source, defaultSpec(), DEFAULT_OPTIONS).volumes[0],
      defaultSpec(),
      { loadImage: () => new Uint8Array() },
    ).pdf.length;
    const withThem = renderVolume(
      planBook(source, defaultSpec(), { ...DEFAULT_OPTIONS, includeVehicles: true }).volumes[0],
      defaultSpec(),
      { loadImage: () => new Uint8Array() },
    ).pdf.length;
    expect(withThem).toBeGreaterThan(withOut);
  });
});

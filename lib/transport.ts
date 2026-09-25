import type { TransportMode } from "./types";

/**
 * How each way of travelling is drawn — colour, line, and the shape of the leg.
 *
 * Shared by the trip map's route lines, the legend directly under them and the
 * slideshow, so the three can never drift apart.
 *
 * **Colour is not allowed to be the only difference.** Four of these modes once
 * had no dash at all, which left train, bus, motorbike and car separated by hue
 * alone — the one distinction some readers cannot make, and the legend
 * underneath does not help somebody looking at the line. Every mode now differs
 * in at least two of colour, dash and curvature.
 *
 * The shapes are meant to be read without the legend:
 *
 * - a **flight** arcs hard and is long-dashed, because it is the one leg that
 *   does not touch the ground;
 * - a **boat** curves gently and is dotted, the way a sea route wanders;
 * - a **train** is nearly straight and solid, because a railway is fixed;
 * - **road** modes are straight, their dashes shortening as the vehicle gets
 *   smaller — bus, then taxi, then car, then motorbike, then bicycle;
 * - a **walk** is straight and finely dotted.
 */
export const TRANSPORT_STYLE: Record<
  TransportMode,
  {
    label: string;
    color: string;
    /**
     * Dash and gap, **in screen pixels**, or absent for a solid line.
     *
     * Pixels rather than viewBox units, and a pair rather than a string,
     * because the caller has to scale it: B46 made the map's frame the size of
     * the trip, so a frame over the Alps is 4.6 units wide and the old
     * `"10 7"` was a dash twice the width of the map. `lib/transport.ts` was
     * the last place that bug survived — it is a data file, and a string of
     * two numbers did not look like a drawing constant.
     */
    dash?: [number, number];
    /**
     * How far the leg bows out, as a fraction of its own length. 0 is a
     * straight line.
     */
    bow: number;
  }
> = {
  flight: { label: "Flight", color: "#3b82f6", dash: [14, 9], bow: 0.24 },
  boat: { label: "Boat", color: "#06b6d4", dash: [2, 7], bow: 0.14 },
  // A ferry is a boat on a fixed crossing — same colour, a shade less bow
  // than the open-ended `boat`, so the two are still told apart by shape
  // alone — B1519.
  ferry: { label: "Ferry", color: "#06b6d4", dash: [2, 7], bow: 0.1 },
  train: { label: "Train", color: "#8b5cf6", bow: 0.05 },
  // Metro and tram are rail modes too, kept visually close to train (same
  // hue, a shorter dash) rather than sharing a road colour — B1519.
  metro: { label: "Metro", color: "#8b5cf6", dash: [5, 3], bow: 0.03 },
  tram: { label: "Tram", color: "#a78bfa", dash: [5, 3], bow: 0.02 },
  bus: { label: "Bus", color: "#f59e0b", dash: [11, 6], bow: 0.03 },
  car: { label: "Car", color: "#14b8a6", dash: [7, 5], bow: 0.03 },
  taxi: { label: "Taxi", color: "#f97316", dash: [9, 4], bow: 0.03 },
  motorbike: { label: "Motorbike", color: "#ef4444", dash: [4, 4], bow: 0.03 },
  bicycle: { label: "Bicycle", color: "#84cc16", dash: [3, 3], bow: 0.02 },
  walk: { label: "Walk", color: "#22c55e", dash: [1.5, 5], bow: 0 },
};

/** The dash pattern as an SVG attribute, with a length scaled into map units. */
export function dashFor(
  style: { dash?: [number, number] },
  px: (pixels: number) => number,
): string | undefined {
  return style.dash ? `${px(style.dash[0])} ${px(style.dash[1])}` : undefined;
}

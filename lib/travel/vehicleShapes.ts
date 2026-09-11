import type { Shape } from "../travellers/shapes";
import type { TransportMode } from "../types";

/**
 * The thing that crosses the screen, as geometry — B737.
 *
 * `components/travel/Vehicle.tsx` used to hold both the drawing and its
 * spelling, as JSX. That was fine while a browser was the only place a vehicle
 * was ever drawn, and stopped being fine the moment the book wanted one: the
 * PDF writer takes paths and flat fills, not React.
 *
 * So this is `lib/travellers/shapes.ts` for vehicles, for exactly the reasons
 * that file gives. B497 is the record of what the alternative costs — the book
 * carried a hand-copied second set of path data and quietly went on printing a
 * couple nobody had described. One geometry, three spellings: the component
 * (with wheels that turn), the preview's SVG, and the book's PDF.
 *
 * **Every vehicle faces right** and sits with its wheels on the bottom edge of
 * its own box, because every leg crosses left to right and the scene puts the
 * baseline where it likes.
 *
 * Two things are deliberately *not* here, because they are spelling rather
 * than geometry:
 *
 *  - **The wheels' rotation.** The shapes below draw a wheel at rest;
 *    `vehicleWheels` says where each one is so the component can turn it. A
 *    printed wheel does not move, and `TravelScene`'s does.
 *  - **The titles** — "Fernscout" along a flank. It is `<text>` in a display
 *    face, the book has Helvetica and nothing else, and at the width a book
 *    draws a car it would be a smudge. The component keeps drawing them; see
 *    `vehicleTitles`.
 */

/** Flat-illustration palette, the same family `Cityscape` draws with. */
const BODY = "#e8746c";
const BODY_DARK = "#c2544c";
const GLASS = "#bfe6f5";
const METAL = "#5a6a80";
const DARK = "#334155";
const CREAM = "#fffaf0";

export type PrintableMode = Exclude<TransportMode, "walk">;

/** Every vehicle is drawn inside this box, wheels on the bottom edge.
 *
 * `metro` and `tram` reuse `train`'s box exactly (B1519) rather than getting
 * their own geometry: the box is only the aspect ratio the shapes below are
 * drawn to, and both `Vehicle` and the photobook scale it to whatever width
 * the caller asks for — `components/TravelScene.tsx`'s `VEHICLE_WIDTH` is
 * what actually makes a metro read as a shorter, urban hop rather than an
 * intercity train, by asking for less of it. `ferry` reuses `boat`'s box the
 * same way, per the ticket's own suggestion. */
export const VEHICLE_BOX: Record<PrintableMode, { width: number; height: number }> = {
  train: { width: 190, height: 54 },
  metro: { width: 190, height: 54 },
  tram: { width: 190, height: 54 },
  flight: { width: 150, height: 52 },
  bus: { width: 132, height: 52 },
  car: { width: 104, height: 44 },
  taxi: { width: 104, height: 44 },
  motorbike: { width: 88, height: 44 },
  bicycle: { width: 78, height: 44 },
  boat: { width: 136, height: 56 },
  ferry: { width: 136, height: 56 },
};

/**
 * What a turning wheel is made of. `tyre` is a road wheel, `iron` a railway
 * one — a steel disc with a counterweight, no spokes — and `spoked` a bicycle,
 * which at this size is the one thing that tells a bicycle from a small
 * motorbike, because you can see through it.
 */
export type WheelLook = "tyre" | "iron" | "spoked";
export type VehicleWheel = { cx: number; cy: number; r: number; look: WheelLook };

/** One wheel at rest, about its own centre. Translated by the caller, so the
 * component can spin the same shapes around 0,0. */
export function wheelShapes(r: number, look: WheelLook): Shape[] {
  if (look === "spoked") {
    return [
      { kind: "circle", cx: 0, cy: 0, r, stroke: DARK, width: r * 0.16 },
      ...[0, 45, 90, 135].map((a): Shape => {
        const rad = (a * Math.PI) / 180;
        const x = r * 0.9 * Math.cos(rad);
        const y = r * 0.9 * Math.sin(rad);
        return { kind: "path", d: `M${-x},${-y} L${x},${y}`, stroke: METAL, width: r * 0.07 };
      }),
      { kind: "circle", cx: 0, cy: 0, r: r * 0.16, fill: DARK },
    ];
  }
  if (look === "iron") {
    return [
      { kind: "circle", cx: 0, cy: 0, r, fill: METAL },
      { kind: "circle", cx: 0, cy: 0, r: r * 0.82, fill: DARK },
      { kind: "circle", cx: 0, cy: 0, r: r * 0.26, fill: METAL },
      // One counterweight, so a railway wheel visibly turns without the spokes
      // that made it a car wheel.
      { kind: "rect", x: -r * 0.09, y: -r * 0.7, w: r * 0.18, h: r * 0.44, fill: METAL },
    ];
  }
  return [
    { kind: "circle", cx: 0, cy: 0, r, fill: DARK },
    { kind: "circle", cx: 0, cy: 0, r: r * 0.5, fill: CREAM },
    { kind: "circle", cx: 0, cy: 0, r: r * 0.16, fill: DARK },
    { kind: "rect", x: -r * 0.06, y: -r * 0.46, w: r * 0.12, h: r * 0.92, fill: DARK, opacity: 0.35 },
    { kind: "rect", x: -r * 0.46, y: -r * 0.06, w: r * 0.92, h: r * 0.12, fill: DARK, opacity: 0.35 },
  ];
}

/** A run of windows along a body, evenly spaced. */
function windows(from: number, y: number, count: number, w = 13, h = 13, gap = 6): Shape[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "rect" as const,
    x: from + i * (w + gap),
    y,
    w,
    h,
    r: 2.5,
    fill: GLASS,
  }));
}

/**
 * An engine, hung under a wing. **Horizontal, always** — thrust goes
 * backwards, so in side view a nacelle lies along the fuselage whatever the
 * wing above it is doing, and the sweep is carried by where it is placed.
 */
function nacelle(x: number, y: number, length: number, thickness: number, fill: string): Shape[] {
  return [
    { kind: "rect", x, y, w: length, h: thickness, r: thickness / 2, fill },
    // the intake lip, at the front, so the pod has a direction
    {
      kind: "rect",
      x: x + length - thickness * 0.7,
      y,
      w: thickness * 0.7,
      h: thickness,
      r: thickness * 0.35,
      fill: DARK,
      opacity: 0.55,
    },
  ];
}

/** Where a wheel goes, per mode. Empty for the two that have none. */
export function vehicleWheels(mode: PrintableMode): VehicleWheel[] {
  switch (mode) {
    // B1545 — `metro` drew as `train`'s two carriages and a locomotive with a
    // boiler and a chimney, which nobody has met at a station. Its own case
    // now: six wheels along one continuous shell, evenly spaced the way the
    // shell's own door seams are.
    case "metro":
      return [17, 47, 78, 108, 141, 171].map((cx) => ({ cx, cy: 46, r: 7, look: "iron" }));
    case "tram":
    case "train":
      // Every wheel the same size: 9, 9 and 6 against the carriages' 7 read as
      // a fault rather than as a driving wheel.
      return [
        ...[4, 64].flatMap((x): VehicleWheel[] => [
          { cx: x + 13, cy: 46, r: 7, look: "iron" },
          { cx: x + 43, cy: 46, r: 7, look: "iron" },
        ]),
        { cx: 136, cy: 46, r: 7, look: "iron" },
        { cx: 160, cy: 46, r: 7, look: "iron" },
        { cx: 179, cy: 46, r: 7, look: "iron" },
      ];
    case "bus":
      return [
        { cx: 26, cy: 44, r: 8, look: "tyre" },
        { cx: 98, cy: 44, r: 8, look: "tyre" },
      ];
    case "car":
    case "taxi":
      return [
        { cx: 26, cy: 36, r: 8, look: "tyre" },
        { cx: 80, cy: 36, r: 8, look: "tyre" },
      ];
    case "motorbike":
      return [
        { cx: 19, cy: 34, r: 10, look: "tyre" },
        { cx: 68, cy: 34, r: 10, look: "tyre" },
      ];
    case "bicycle":
      return [
        { cx: 17, cy: 31, r: 13, look: "spoked" },
        { cx: 58, cy: 31, r: 13, look: "spoked" },
      ];
    default:
      return [];
  }
}

/**
 * The name painted on a flank — `<text>`, and therefore the component's
 * business rather than the book's. See the file's own note.
 */
export function vehicleTitles(
  mode: PrintableMode,
): { x: number; y: number; size: number; fill: string }[] {
  switch (mode) {
    case "metro":
      return [{ x: 78, y: 31, size: 6.5, fill: "#8a6a1f" }];
    case "tram":
    case "train":
      return [4, 64].map((x) => ({ x: x + 6, y: 37, size: 6.5, fill: "#dbeaf7" }));
    case "flight":
      return [{ x: 36, y: 31, size: 7.5, fill: "#8fa3bd" }];
    case "bus":
      return [{ x: 40, y: 32.5, size: 6.5, fill: "#8a6a1f" }];
    case "ferry":
    case "boat":
      return [{ x: 26, y: 38, size: 7.5, fill: "#f6c9c4" }];
    default:
      return [];
  }
}

/**
 * Everything but the wheels and the titles, in the mode's own box.
 *
 * Read this against `components/travel/Vehicle.tsx`'s history: the reasoning
 * for why a plane's wings rake backwards, why the locomotive is at the
 * right-hand end, and why a bicycle has all seven of its tubes is written
 * there and is not repeated here, because that is a conversation about the
 * drawing and this is the drawing.
 */
export function vehicleBody(mode: PrintableMode): Shape[] {
  switch (mode) {
    // B1545 — one continuous shell rather than distinct carriages behind a
    // locomotive: a metro set is welded cars, not an engine pulling coaches,
    // and this is what a platform actually sees pull in. Door seams (the
    // darker verticals) are the only break in the body; the front is a
    // blunt rounded nose rather than a boiler and a chimney.
    case "metro": {
      const seam = (x: number): Shape => ({ kind: "rect", x, y: 12, w: 3, h: 26, fill: "#c99a35", opacity: 0.7 });
      // Three windows, centred in a bay of width w.
      const bay = (x: number, w: number): Shape[] => windows(x + (w - 47) / 2, 18, 3, 13, 12, 4);
      return [
        { kind: "rect", x: 4, y: 10, w: 182, h: 30, r: 8, fill: "#f0c05a" },
        { kind: "rect", x: 4, y: 8, w: 178, h: 3, r: 1.5, fill: "#f7cf78" },
        { kind: "rect", x: 4, y: 36, w: 178, h: 4, r: 2, fill: "#c99a35" },
        ...bay(8, 60),
        seam(60),
        ...bay(65, 60),
        seam(122),
        ...bay(127, 55),
      ];
    }
    // `tram` draws the same carriages as `train` — B1519 leans on
    // `VEHICLE_WIDTH` in the scene to make one read as a short urban hop
    // rather than an intercity trip, rather than drawing a second locomotive.
    case "tram":
    case "train": {
      const carriage = (x: number): Shape[] => [
        { kind: "rect", x, y: 14, w: 56, h: 26, r: 4, fill: "#6ea8dc" },
        { kind: "rect", x, y: 12, w: 56, h: 5, r: 2.5, fill: "#4a80ad" },
        ...windows(x + 6, 20, 2, 13, 12, 5),
      ];
      return [
        // couplings, behind everything
        { kind: "rect", x: 56, y: 32, w: 12, h: 4, fill: METAL },
        { kind: "rect", x: 118, y: 32, w: 12, h: 4, fill: METAL },
        ...carriage(4),
        ...carriage(64),
        // the locomotive, at the front: cab behind, boiler and chimney ahead
        { kind: "path", d: "M122,40 L122,22 Q122,14 132,14 L168,14 L168,40 Z", fill: BODY },
        { kind: "rect", x: 122, y: 38, w: 62, h: 5, r: 2, fill: BODY_DARK },
        { kind: "rect", x: 130, y: 19, w: 26, h: 13, r: 2.5, fill: GLASS },
        { kind: "rect", x: 168, y: 18, w: 16, h: 22, r: 3, fill: BODY_DARK },
        { kind: "rect", x: 170, y: 4, w: 9, h: 11, r: 2, fill: BODY_DARK },
      ];
    }

    case "flight":
      return [
        // far wing, behind the body, its engine drawn before it
        ...nacelle(57, 15.5, 14, 5, "#43506a"),
        { kind: "path", d: "M86,22 L58,3 L50,5 L74,22 Z", fill: BODY_DARK },
        // the fin, rooted over the tail and swept
        { kind: "path", d: "M11,21 L17,2 L24,2 L30,20 Z", fill: BODY },
        // the body: blunt tail at the left, tapered nose at the right
        {
          kind: "path",
          d: "M10,29 Q6,23 16,21 L106,19 Q128,19 140,27 Q128,35 106,35 L16,33 Q6,31 10,29 Z",
          fill: CREAM,
        },
        // the tailplane, in front of the body rather than behind it
        { kind: "path", d: "M28,26 L9,18 L6,21.5 L25,28.5 Z", fill: BODY_DARK },
        ...windows(76, 23, 4, 7, 6, 7),
        // the cockpit: raked, up against the nose, above the window line
        { kind: "path", d: "M116,22 L127,21.8 Q133,23.5 136,26 L116,26 Z", fill: GLASS },
        // near wing, over the body, with the engine on a pylon beneath it
        { kind: "path", d: "M92,31 L64,45 L54,44 L78,30 Z", fill: BODY },
        { kind: "path", d: "M71,41.5 L79,37.5 L81,45 L73,45 Z", fill: "#4b5a72" },
        ...nacelle(64, 44, 22, 7, METAL),
      ];

    case "bus":
      return [
        { kind: "rect", x: 4, y: 8, w: 118, h: 32, r: 6, fill: "#f0c05a" },
        { kind: "rect", x: 4, y: 34, w: 118, h: 7, r: 3, fill: "#c99a35" },
        ...windows(12, 13, 4, 14, 13, 5),
        { kind: "rect", x: 100, y: 13, w: 16, h: 13, r: 2.5, fill: GLASS },
      ];

    case "car":
    case "taxi": {
      const shell = mode === "taxi" ? "#f0b429" : BODY;
      const shellDark = mode === "taxi" ? "#c08b16" : BODY_DARK;
      const livery: Shape[] =
        mode === "taxi"
          ? [
              // the roof sign and a chequer along the sill — the two things
              // that survive being drawn a hundred pixels wide
              { kind: "rect", x: 48, y: 1, w: 17, h: 6, r: 1.5, fill: CREAM },
              { kind: "rect", x: 48, y: 5.5, w: 17, h: 1.5, fill: DARK },
              ...Array.from({ length: 9 }, (_, i): Shape => ({
                kind: "rect",
                x: 16 + i * 8,
                y: i % 2 ? 25 : 21.5,
                w: 8,
                h: 3.5,
                fill: DARK,
                opacity: 0.75,
              })),
            ]
          : [];
      return [
        // greenhouse: short rear pillar, long raked windscreen
        { kind: "path", d: "M26,19 Q34,6 44,6 L64,6 Q76,7 88,19 Z", fill: shellDark },
        { kind: "path", d: "M33,17 Q38,9.5 45,9.5 L48,9.5 L48,17 Z", fill: GLASS },
        { kind: "path", d: "M53,9.5 L62,9.5 Q72,10.5 81,17 L53,17 Z", fill: GLASS },
        // body: a slight wedge, low nose, short overhangs
        { kind: "path", d: "M5,33 L5,24 Q5,18 13,18 L92,18 Q100,20 101,26 L101,33 Z", fill: shell },
        { kind: "rect", x: 5, y: 28, w: 96, h: 5.5, r: 2.5, fill: shellDark },
        // which way it is going: headlight at the nose, lamp at the tail
        { kind: "rect", x: 92, y: 21, w: 9, h: 4.5, r: 2.25, fill: CREAM, opacity: 0.95 },
        { kind: "rect", x: 5, y: 21, w: 5, h: 4, r: 2, fill: mode === "taxi" ? "#8f5f0f" : "#a83c34" },
        ...livery,
      ];
    }

    case "motorbike":
      return [
        // swingarm and fork, behind everything they carry
        { kind: "path", d: "M19,34 L34,28", stroke: METAL, width: 3.5 },
        { kind: "path", d: "M68,34 L58,13", stroke: METAL, width: 4 },
        // engine, and the pipe running back from it
        { kind: "rect", x: 30, y: 22, w: 16, h: 10, r: 2.5, fill: DARK },
        { kind: "rect", x: 17, y: 28.5, w: 23, h: 3.5, r: 1.75, fill: METAL },
        // tail, seat and tank — the line a bike is recognised by
        { kind: "path", d: "M16,21 L19,16 L25,16 L26,21 Z", fill: BODY_DARK },
        { kind: "rect", x: 19, y: 16, w: 15, h: 3, r: 1.5, fill: DARK },
        { kind: "path", d: "M34,22 Q36,15 43,14.5 L53,17 L54,22 Z", fill: BODY },
        // bars across the top of the fork, headlight in front of it
        { kind: "path", d: "M52,14 L64,9.5", stroke: DARK, width: 3 },
        { kind: "circle", cx: 61.5, cy: 15, r: 3.4, fill: CREAM },
      ];

    case "bicycle":
      return [
        // the frame, all seven tubes — the head tube is the short one nobody
        // draws and the one that matters
        {
          kind: "path",
          d: "M33,31 L28,11 M33,31 L54,17 M28,11 L52,10 M33,31 L17,31 M28,11 L17,31 M52,10 L54,17",
          stroke: BODY,
          width: 2.5,
        },
        { kind: "path", d: "M54,17 L58,31", stroke: METAL, width: 2.5 },
        { kind: "path", d: "M52,10 L58,8", stroke: DARK, width: 2.4 },
        // saddle, and the cranks at the bottom bracket
        { kind: "rect", x: 22, y: 8.5, w: 11, h: 2.6, r: 1.3, fill: DARK },
        { kind: "circle", cx: 33, cy: 31, r: 2.6, fill: DARK },
        { kind: "path", d: "M33,31 L37,34", stroke: METAL, width: 2 },
        { kind: "rect", x: 36, y: 34, w: 5, h: 1.8, r: 0.9, fill: DARK },
      ];

    // `ferry` reuses `boat`'s hull rather than earning its own — the
    // ticket's own suggestion where there is no time for bespoke art.
    case "ferry":
    case "boat":
      return [
        { kind: "rect", x: 44, y: 4, w: 3, h: 22, r: 1.5, fill: METAL },
        // the pennant streams back from the mast, away from the way the hull
        // is going
        { kind: "path", d: "M44,5 L20,13 L44,20 Z", fill: CREAM },
        { kind: "rect", x: 54, y: 20, w: 44, h: 16, r: 3, fill: CREAM },
        ...windows(60, 24, 3, 9, 8, 5),
        { kind: "path", d: "M14,26 L122,26 L108,44 Q104,47 98,47 L30,47 Q24,47 20,42 Z", fill: BODY },
        { kind: "rect", x: 14, y: 26, w: 108, h: 5, fill: BODY_DARK },
      ];
  }
}

/**
 * The whole vehicle at rest — body, then every wheel translated into place.
 *
 * What the book and the preview draw. The component uses `vehicleBody` and
 * `vehicleWheels` separately so its wheels can turn.
 */
export function vehicleShapes(mode: PrintableMode): Shape[] {
  return [
    ...vehicleBody(mode),
    ...vehicleWheels(mode).flatMap((w) =>
      translate(wheelShapes(w.r, w.look), w.cx, w.cy),
    ),
  ];
}

/**
 * Move shapes by (dx, dy).
 *
 * `Shape`'s only transform is a horizontal flip, so a translation has to be
 * baked into the coordinates — including a path's `d`, which is why this
 * shifts the numbers in it. Every path here is written with absolute commands
 * and no arcs, which is what makes that safe; `lib/travellers/path.ts` is the
 * general parser and is deliberately not needed for this.
 */
function translate(shapes: Shape[], dx: number, dy: number): Shape[] {
  return shapes.map((shape): Shape => {
    switch (shape.kind) {
      case "path":
        return { ...shape, d: shiftPath(shape.d, dx, dy) };
      case "circle":
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      case "ellipse":
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      case "rect":
        return { ...shape, x: shape.x + dx, y: shape.y + dy };
      case "group":
        return { ...shape, aboutX: shape.aboutX + dx, shapes: translate(shape.shapes, dx, dy) };
    }
  });
}

/** `M12,4 L20,9` → the same, moved. Absolute commands only, which is all the
 * wheels use. */
function shiftPath(d: string, dx: number, dy: number): string {
  return d.replace(/([ML])\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g, (_, cmd, x, y) =>
    `${cmd}${Number(x) + dx},${Number(y) + dy}`,
  );
}

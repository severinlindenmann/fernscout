"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  VEHICLE_BOX,
  vehicleBody,
  vehicleTitles,
  vehicleWheels,
  wheelShapes,
  type PrintableMode,
} from "@/lib/travel/vehicleShapes";
import { shapesToSvg } from "@/lib/travellers/render";
import type { TransportMode } from "@/lib/types";

/**
 * The thing that crosses the screen, drawn.
 *
 * It used to be a lucide glyph inside a white rounded box with a drop shadow,
 * which is an interface chip — the same object the rest of the site uses for a
 * button — sliding over an illustrated landscape. At any size it read as a
 * tooltip that had escaped, and the mode it named was a 24px line drawing
 * nobody could tell from the next one at a glance.
 *
 * These are drawn in `Cityscape`'s vocabulary instead: flat fills, no strokes
 * except where a stroke is the thing (rigging, a wheel spoke), rounded
 * corners, and the same saturated palette. Every one faces right, because
 * every leg crosses left to right, and every one sits on `y = 0` so the scene
 * can put its wheels on a rail or its hull in water without per-mode nudging.
 *
 * **The geometry moved to `lib/travel/vehicleShapes.ts` in B737**, when the
 * photobook wanted to draw the same vehicles on paper. Every argument about
 * why a plane's wings rake backwards, why the locomotive is at the right-hand
 * end and why a bicycle has all seven of its tubes is still recorded there,
 * beside the shapes those arguments are about. This file is now what it should
 * always have been: one spelling of that geometry, the one that moves.
 *
 * `walk` is deliberately not drawn. A leg on foot has no vehicle — the party
 * itself crosses, which the scene handles by leaving them on screen.
 */

/**
 * A wheel that turns while the vehicle is moving.
 *
 * The rotation is what sells a crossing as travel rather than as a picture
 * being slid across, and it is the one piece of motion here that reduced
 * motion has to switch off — a spinning wheel is exactly the kind of small
 * repeating rotation that setting exists for.
 *
 * Translated by an outer `<g>` and rotated about its own 0,0 by the inner one.
 * Motion's `originX`/`originY` are fractions of the *bounding box* on SVG, not
 * user units, so passing the wheel's centre in px sent every wheel spinning
 * off across the frame on its own orbit — visible immediately, and only in a
 * browser. That is why `wheelShapes` draws a wheel about the origin and this
 * puts it in place.
 */
function Wheel({
  cx,
  cy,
  r,
  look,
  spin,
}: {
  cx: number;
  cy: number;
  r: number;
  look: Parameters<typeof wheelShapes>[1];
  spin: boolean;
}) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <motion.g
        style={{ transformOrigin: "0px 0px" }}
        animate={spin ? { rotate: 360 } : undefined}
        transition={spin ? { duration: 0.9, repeat: Infinity, ease: "linear" } : undefined}
        dangerouslySetInnerHTML={{ __html: shapesToSvg(wheelShapes(r, look)) }}
      />
    </g>
  );
}

/**
 * The name, painted on the side, the way a vehicle actually carries one.
 *
 * The first attempt stamped the app icon on each flank — the navy tile, the
 * lozenge and all — which is a sticker on a bus, not a livery. Airlines put
 * titles along the fuselage, a ship's name goes on the bow, an operator's
 * name runs down a carriage. So this is the wordmark: `Fredoka 700`, which
 * is what `docs/branding/fernscout-wordmark.svg` is, set at the size the
 * flank has room for and in one ink.
 *
 * It is small on purpose. At the width a car is drawn in the story it is a
 * decal you notice on the second look, which is the whole idea.
 *
 * It stays in this file rather than in the geometry because it is `<text>` in
 * a display face, and the book has Helvetica and nothing else — see
 * `vehicleTitles`.
 */
function Titles({ x, y, size, fill }: { x: number; y: number; size: number; fill: string }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={700}
      fill={fill}
      style={{ fontFamily: "var(--font-display), Fredoka, 'Trebuchet MS', sans-serif" }}
    >
      Fernscout
    </text>
  );
}

export default function Vehicle({
  mode,
  width,
}: {
  /** `walk` renders nothing — see the note at the top of the file. */
  mode: TransportMode;
  /** Drawn width in px; the height follows the mode's own proportions. */
  width: number;
}) {
  const reduced = useReducedMotion();
  const spin = !reduced;
  if (mode === "walk") return null;

  const printable = mode as PrintableMode;
  const box = VEHICLE_BOX[printable];
  const height = (width / box.width) * box.height;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <g dangerouslySetInnerHTML={{ __html: shapesToSvg(vehicleBody(printable)) }} />
      {vehicleTitles(printable).map((t, i) => (
        <Titles key={i} {...t} />
      ))}
      {vehicleWheels(printable).map((w, i) => (
        <Wheel key={i} {...w} spin={spin} />
      ))}
    </svg>
  );
}

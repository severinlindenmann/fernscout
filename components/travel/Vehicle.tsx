"use client";

import { motion, useReducedMotion } from "motion/react";
import type { TransportMode } from "@/lib/types";

/**
 * The thing that crosses the screen, drawn.
 *
 * It used to be a lucide glyph inside a white rounded box with a drop shadow,
 * which is a interface chip — the same object the rest of the site uses for a
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
 * `walk` is deliberately not here. A leg on foot has no vehicle — the party
 * itself crosses, which the scene handles by leaving them on screen.
 */

/** Flat-illustration palette, the same family `Cityscape` draws with. */
const BODY = "#e8746c";
const BODY_DARK = "#c2544c";
const GLASS = "#bfe6f5";
const METAL = "#5a6a80";
const DARK = "#334155";
const CREAM = "#fffaf0";

/** Every vehicle is drawn inside this box, wheels on the bottom edge. */
export type VehicleBox = { width: number; height: number };

export const VEHICLE_BOX: Record<Exclude<TransportMode, "walk">, VehicleBox> = {
  train: { width: 190, height: 54 },
  flight: { width: 150, height: 52 },
  bus: { width: 132, height: 52 },
  car: { width: 104, height: 44 },
  motorbike: { width: 84, height: 46 },
  boat: { width: 136, height: 56 },
};

/**
 * A wheel that turns while the vehicle is moving.
 *
 * The rotation is what sells a crossing as travel rather than as a picture
 * being slid across, and it is the one piece of motion here that reduced
 * motion has to switch off — a spinning wheel is exactly the kind of small
 * repeating rotation that setting exists for.
 */
function Wheel({
  cx,
  cy,
  r,
  spin,
  spokes = true,
}: {
  cx: number;
  cy: number;
  r: number;
  spin: boolean;
  spokes?: boolean;
}) {
  // Translated by an outer <g> and rotated about its own 0,0 by the inner one.
  // Motion's `originX`/`originY` are fractions of the *bounding box* on SVG,
  // not user units, so passing the wheel's centre in px sent every wheel
  // spinning off across the frame on its own orbit — visible immediately, and
  // only in a browser.
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <motion.g
        style={{ transformOrigin: "0px 0px" }}
        animate={spin ? { rotate: 360 } : undefined}
        transition={spin ? { duration: 0.9, repeat: Infinity, ease: "linear" } : undefined}
      >
        <circle cx={0} cy={0} r={r} fill={DARK} />
        <circle cx={0} cy={0} r={r * 0.42} fill={CREAM} />
        {spokes && (
          <>
            <rect x={-r * 0.08} y={-r * 0.8} width={r * 0.16} height={r * 1.6} fill={CREAM} opacity={0.5} />
            <rect x={-r * 0.8} y={-r * 0.08} width={r * 1.6} height={r * 0.16} fill={CREAM} opacity={0.5} />
          </>
        )}
      </motion.g>
    </g>
  );
}

/** A run of windows along a body, evenly spaced. */
function Windows({
  from,
  y,
  count,
  w = 13,
  h = 13,
  gap = 6,
}: {
  from: number;
  y: number;
  count: number;
  w?: number;
  h?: number;
  gap?: number;
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <rect key={i} x={from + i * (w + gap)} y={y} width={w} height={h} rx={2.5} fill={GLASS} />
      ))}
    </>
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

  const box = VEHICLE_BOX[mode];
  const height = (width / box.width) * box.height;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      aria-hidden
      style={{ overflow: "visible" }}
    >
      {mode === "train" && <Train spin={spin} />}
      {mode === "flight" && <Plane />}
      {mode === "bus" && <Bus spin={spin} />}
      {mode === "car" && <Car spin={spin} />}
      {mode === "motorbike" && <Motorbike spin={spin} />}
      {mode === "boat" && <Boat />}
    </svg>
  );
}

/**
 * Two carriages and a locomotive, coupled, wheels on the baseline.
 *
 * **The locomotive is at the right-hand end**, because every leg crosses left
 * to right and the engine goes in front. It was drawn at the left for one
 * version, which is a train being pushed backwards down the line — and unlike
 * most of the details here, that one is legible at a glance to anybody who has
 * ever seen a train.
 */
function Train({ spin }: { spin: boolean }) {
  const base = 46;
  return (
    <g>
      {/* couplings, behind everything */}
      <rect x={56} y={base - 14} width={12} height={4} fill={METAL} />
      <rect x={118} y={base - 14} width={12} height={4} fill={METAL} />

      {/* the two carriages, trailing */}
      {[4, 64].map((x) => (
        <g key={x}>
          <rect x={x} y={14} width={56} height={26} rx={4} fill="#6ea8dc" />
          <rect x={x} y={12} width={56} height={5} rx={2.5} fill="#4a80ad" />
          <Windows from={x + 6} y={20} count={2} w={16} h={12} gap={6} />
          <Wheel cx={x + 13} cy={base} r={7} spin={spin} />
          <Wheel cx={x + 43} cy={base} r={7} spin={spin} />
        </g>
      ))}

      {/* the locomotive, at the front: cab behind, boiler and chimney ahead */}
      <g transform="translate(122 0)">
        <path d={`M0,40 L0,22 Q0,14 10,14 L46,14 L46,40 Z`} fill={BODY} />
        <rect x={0} y={38} width={62} height={5} rx={2} fill={BODY_DARK} />
        <rect x={8} y={19} width={26} height={13} rx={2.5} fill={GLASS} />
        <rect x={46} y={18} width={16} height={22} rx={3} fill={BODY_DARK} />
        {/* the chimney sits over the boiler, which is the front half */}
        <rect x={48} y={4} width={9} height={11} rx={2} fill={BODY_DARK} />
        <Wheel cx={14} cy={base} r={9} spin={spin} />
        <Wheel cx={38} cy={base} r={9} spin={spin} />
        <Wheel cx={56} cy={base} r={6} spin={spin} />
      </g>
    </g>
  );
}

/**
 * Side-on: far wing behind the fuselage, near wing in front of it, which is
 * the whole trick that stops a flat plane reading as a paper dart.
 *
 * **Everything sweeps backwards.** The nose is at the right because every leg
 * crosses left to right, so a wing tip belongs behind its root, nearer the
 * tail. An early version had them raked the other way and the aircraft read as
 * flying backwards; the version after that had them right but rooted too far
 * forward and cut too deep, so the wings were bigger than the fuselage and the
 * engine hung in mid-air under nothing. They are short-chord now, rooted at
 * the middle of the body where a wing actually joins, and the engine is under
 * the near one.
 */
function Plane() {
  return (
    <g>
      {/* far wing — up and back, behind the body */}
      <path d={`M88,22 L60,7 L50,9 L74,24 Z`} fill={BODY_DARK} />
      {/* fin and stabiliser, both raked back over the tail */}
      <path d={`M30,20 L18,3 L26,3 L42,19 Z`} fill={BODY} />
      <path d={`M20,25 L6,20 L4,24 L18,28 Z`} fill={BODY_DARK} />
      {/* the body: blunt tail at the left, tapered nose at the right */}
      <path
        d={`M10,29 Q6,23 16,21 L106,19 Q128,19 140,27 Q128,35 106,35 L16,33 Q6,31 10,29 Z`}
        fill={CREAM}
      />
      <Windows from={44} y={23} count={6} w={7} h={6} gap={7} />
      <circle cx={130} cy={27} r={3.5} fill={GLASS} />
      {/* near wing — down and back, over the body, engine slung beneath it */}
      <path d={`M92,31 L64,45 L54,44 L78,30 Z`} fill={BODY} />
      <rect x={64} y={37} width={17} height={7} rx={3.5} fill={METAL} />
    </g>
  );
}

function Bus({ spin }: { spin: boolean }) {
  const base = 44;
  return (
    <g>
      <rect x={4} y={8} width={118} height={32} rx={6} fill="#f0c05a" />
      <rect x={4} y={34} width={118} height={7} rx={3} fill="#c99a35" />
      <Windows from={11} y={13} count={5} w={15} h={13} gap={5} />
      <rect x={100} y={13} width={16} height={13} rx={2.5} fill={GLASS} />
      <Wheel cx={26} cy={base} r={8} spin={spin} />
      <Wheel cx={98} cy={base} r={8} spin={spin} />
    </g>
  );
}

function Car({ spin }: { spin: boolean }) {
  const base = 36;
  return (
    <g>
      <path d={`M22,18 Q30,5 50,5 L68,5 Q80,6 88,18 Z`} fill={BODY_DARK} />
      <path d={`M30,17 Q35,9 50,9 L52,9 L52,17 Z`} fill={GLASS} />
      <path d={`M57,9 L66,9 Q76,10 82,17 L57,17 Z`} fill={GLASS} />
      <rect x={6} y={17} width={92} height={16} rx={7} fill={BODY} />
      <rect x={6} y={28} width={92} height={6} rx={3} fill={BODY_DARK} />
      <Wheel cx={26} cy={base} r={8} spin={spin} />
      <Wheel cx={78} cy={base} r={8} spin={spin} />
    </g>
  );
}

function Motorbike({ spin }: { spin: boolean }) {
  const base = 36;
  return (
    <g>
      {/* the rider, blocked in rather than drawn — at this size a face is
          noise, and the party's own likenesses are the figures on foot */}
      <circle cx={40} cy={7} r={7} fill="#f4a259" />
      <path d={`M30,26 Q34,13 42,13 Q52,13 54,20 L60,26 Z`} fill="#5fb08a" />
      <path d={`M54,18 L66,14`} stroke="#5fb08a" strokeWidth={5} strokeLinecap="round" />
      <rect x={26} y={24} width={36} height={7} rx={3.5} fill={BODY} />
      <path d={`M62,14 L70,12`} stroke={DARK} strokeWidth={3.5} strokeLinecap="round" />
      <Wheel cx={22} cy={base} r={10} spin={spin} />
      <Wheel cx={68} cy={base} r={10} spin={spin} />
    </g>
  );
}

/** No wheels; the scene bobs the whole hull instead — see `TravelScene`. */
function Boat() {
  return (
    <g>
      <rect x={44} y={4} width={3} height={22} rx={1.5} fill={METAL} />
      {/* The pennant streams *back* from the mast — away from the way the hull
          is going, which is right. Pointed forward it read as a boat sailing
          into its own flag. */}
      <path d={`M44,5 L20,13 L44,20 Z`} fill={CREAM} />
      <rect x={54} y={20} width={44} height={16} rx={3} fill={CREAM} />
      <Windows from={60} y={24} count={3} w={9} h={8} gap={5} />
      <path d={`M14,26 L122,26 L108,44 Q104,47 98,47 L30,47 Q24,47 20,42 Z`} fill={BODY} />
      <rect x={14} y={26} width={108} height={5} fill={BODY_DARK} />
    </g>
  );
}

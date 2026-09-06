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
  taxi: { width: 104, height: 44 },
  motorbike: { width: 88, height: 44 },
  bicycle: { width: 78, height: 44 },
  boat: { width: 136, height: 56 },
};

/**
 * What a turning wheel is made of.
 *
 * `tyre` is a road wheel — a dark tyre with a pale hub. `iron` is a railway
 * wheel: a steel disc with a tyre band round it and a small hub, no spokes,
 * because that is what is under a carriage and the cream-centred road wheel
 * that used to be there made a train look like it was running on car tyres.
 * `spoked` is a bicycle — a rim, thin spokes, and air in between.
 */
type WheelLook = "tyre" | "iron" | "spoked";

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
  look = "tyre",
}: {
  cx: number;
  cy: number;
  r: number;
  spin: boolean;
  look?: WheelLook;
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
        {look === "spoked" ? (
          <>
            <circle cx={0} cy={0} r={r} fill="none" stroke={DARK} strokeWidth={r * 0.16} />
            {[0, 45, 90, 135].map((a) => (
              <line
                key={a}
                x1={-r * 0.9 * Math.cos((a * Math.PI) / 180)}
                y1={-r * 0.9 * Math.sin((a * Math.PI) / 180)}
                x2={r * 0.9 * Math.cos((a * Math.PI) / 180)}
                y2={r * 0.9 * Math.sin((a * Math.PI) / 180)}
                stroke={METAL}
                strokeWidth={r * 0.07}
              />
            ))}
            <circle cx={0} cy={0} r={r * 0.16} fill={DARK} />
          </>
        ) : look === "iron" ? (
          <>
            <circle cx={0} cy={0} r={r} fill={METAL} />
            <circle cx={0} cy={0} r={r * 0.82} fill={DARK} />
            <circle cx={0} cy={0} r={r * 0.26} fill={METAL} />
            {/* One counterweight, so a railway wheel visibly turns without
                the spokes that made it a car wheel. */}
            <rect x={-r * 0.09} y={-r * 0.7} width={r * 0.18} height={r * 0.44} fill={METAL} />
          </>
        ) : (
          <>
            <circle cx={0} cy={0} r={r} fill={DARK} />
            <circle cx={0} cy={0} r={r * 0.5} fill={CREAM} />
            <circle cx={0} cy={0} r={r * 0.16} fill={DARK} />
            <rect x={-r * 0.06} y={-r * 0.46} width={r * 0.12} height={r * 0.92} fill={DARK} opacity={0.35} />
            <rect x={-r * 0.46} y={-r * 0.06} width={r * 0.92} height={r * 0.12} fill={DARK} opacity={0.35} />
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
 */
function Titles({
  x,
  y,
  size,
  fill,
}: {
  x: number;
  y: number;
  /** Cap height in viewBox units. Below about 5 it stops being letters. */
  size: number;
  fill: string;
}) {
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
      {mode === "taxi" && <Car spin={spin} taxi />}
      {mode === "motorbike" && <Motorbike spin={spin} />}
      {mode === "bicycle" && <Bicycle spin={spin} />}
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
          <Windows from={x + 6} y={20} count={2} w={13} h={12} gap={5} />
          <Titles x={x + 6} y={37} size={6.5} fill="#dbeaf7" />
          <Wheel cx={x + 13} cy={base} r={7} spin={spin} look="iron" />
          <Wheel cx={x + 43} cy={base} r={7} spin={spin} look="iron" />
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
        {/* All three the size of every other wheel on the train. They were
            9, 9 and 6 against the carriages' 7, which on a flat drawing at
            this size reads as a fault rather than as a driving wheel. */}
        <Wheel cx={14} cy={base} r={7} spin={spin} look="iron" />
        <Wheel cx={38} cy={base} r={7} spin={spin} look="iron" />
        <Wheel cx={57} cy={base} r={7} spin={spin} look="iron" />
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
 * the middle of the body where a wing actually joins, and each one carries an
 * engine — see `Nacelle` below for why that is two shapes and not one.
 */
function Plane() {
  return (
    <g>
      {/* Far wing — up and back, behind the body. Both root corners are
          *inside* the fuselage (its top edge runs y≈19-21 across here), which
          is what attaches it: drawn clear of the body it was a red shape
          hovering over the aircraft with daylight between the two.
          Its engine is drawn *before* it, so the wing passes in front: on the
          far side of the aircraft the wing is nearer the viewer than the pod
          slung under it, and drawn the other way round the pod sat on top of
          the wing. It disappears behind the fuselage below, which is exactly
          how much of a far engine you would see. */}
      <Nacelle x={57} y={15.5} length={14} thickness={5} fill="#43506a" />
      <path d={`M86,22 L58,3 L50,5 L74,22 Z`} fill={BODY_DARK} />
      {/* The fin. It used to be rooted at x=30..42 — a third of the way up
          the fuselage, so it read as a sail amidships. Rooted over the tail
          now, and swept: the leading edge (30,21)→(22,3) leans back, which
          an upright trapezoid did not. */}
      <path d={`M11,21 L17,2 L24,2 L30,20 Z`} fill={BODY} />
      {/* the body: blunt tail at the left, tapered nose at the right */}
      <path
        d={`M10,29 Q6,23 16,21 L106,19 Q128,19 140,27 Q128,35 106,35 L16,33 Q6,31 10,29 Z`}
        fill={CREAM}
      />
      {/* The tailplane, in front of the body rather than behind it. Behind,
          the fuselage covered all but the last four units of it and what
          showed read as a pennant tied to the tail. */}
      <path d={`M28,26 L9,18 L6,21.5 L25,28.5 Z`} fill={BODY_DARK} />
      <Titles x={36} y={31} size={7.5} fill="#8fa3bd" />
      <Windows from={76} y={23} count={4} w={7} h={6} gap={7} />
      {/* The cockpit, which was a circle floating in the middle of the nose
          cone — a porthole, at the one place on an aircraft that has none.
          It is a windscreen now: raked, up against the nose, and above the
          window line the way a flight deck is. */}
      <path d={`M116,22 L127,21.8 Q133,23.5 136,26 L116,26 Z`} fill={GLASS} />
      {/* near wing — down and back, over the body — and the engine slung
          properly beneath it. The pod used to lie *along* the wing at the
          root, which at a glance was a grey stripe painted on the wing. It
          hangs below the whole of it now, on a pylon: without the pylon the
          pod floats loose under the aircraft, which was the other version of
          the same fault. */}
      <path d={`M92,31 L64,45 L54,44 L78,30 Z`} fill={BODY} />
      <path d={`M71,41.5 L79,37.5 L81,45 L73,45 Z`} fill="#4b5a72" />
      <Nacelle x={64} y={44} length={22} thickness={7} fill={METAL} />
    </g>
  );
}

/**
 * An engine, hung under a wing.
 *
 * **Horizontal, always.** The first version rotated each one to its wing's
 * sweep, which put the intakes out along the span — an engine pointing
 * sideways, blowing at the wingtip. Thrust goes backwards, so in side view a
 * nacelle lies along the fuselage whatever the wing above it is doing, and
 * the sweep is carried by where it is placed rather than by how it is turned.
 *
 * Placed so the inboard end laps over the wing it hangs from and the outboard
 * end clears it, which is what reads as attached rather than as floating.
 */
function Nacelle({
  x,
  y,
  length,
  thickness,
  fill,
}: {
  x: number;
  y: number;
  length: number;
  thickness: number;
  fill: string;
}) {
  return (
    <>
      <rect x={x} y={y} width={length} height={thickness} rx={thickness / 2} fill={fill} />
      {/* the intake lip, at the front, so the pod has a direction */}
      <rect
        x={x + length - thickness * 0.7}
        y={y}
        width={thickness * 0.7}
        height={thickness}
        rx={thickness * 0.35}
        fill={DARK}
        opacity={0.55}
      />
    </>
  );
}

function Bus({ spin }: { spin: boolean }) {
  const base = 44;
  return (
    <g>
      <rect x={4} y={8} width={118} height={32} rx={6} fill="#f0c05a" />
      <rect x={4} y={34} width={118} height={7} rx={3} fill="#c99a35" />
      {/* Four windows rather than five: the fifth ran under the driver's
          own, and dropping it is what makes room for the mark. */}
      <Windows from={12} y={13} count={4} w={14} h={13} gap={5} />
      {/* Under the windows and across the middle of the flank, which is where
          an operator's name goes on a bus. Up in the front corner it was the
          first thing in the frame and read as a headline. */}
      <Titles x={40} y={32.5} size={6.5} fill="#8a6a1f" />
      <rect x={100} y={13} width={16} height={13} rx={2.5} fill={GLASS} />
      <Wheel cx={26} cy={base} r={8} spin={spin} />
      <Wheel cx={98} cy={base} r={8} spin={spin} />
    </g>
  );
}

/**
 * A modern hatchback, nose at the right.
 *
 * The one before it was very nearly symmetrical — a centred roof, a bonnet
 * and a boot the same length, and glass raked the same amount at both ends —
 * so at a glance it read as a car reversing down the road. Three things fix
 * that and they are all about which end is the front: the cabin sits back
 * over the rear axle, the windscreen is a long forward rake against a short
 * upright rear window, and there is a headlight at the nose and a tail lamp
 * at the tail, which is the cue a reader takes first.
 *
 * `taxi` is the same shape in a livery. See the note inside.
 */
function Car({ spin, taxi = false }: { spin: boolean; taxi?: boolean }) {
  const base = 36;
  // A taxi is the same car in a different trade's paint — one drawing, two
  // liveries, because a second body traced by hand would drift from this one
  // the first time either was touched.
  const shell = taxi ? "#f0b429" : BODY;
  const shellDark = taxi ? "#c08b16" : BODY_DARK;
  return (
    <g>
      {/* greenhouse: short rear pillar, long raked windscreen */}
      <path d={`M26,19 Q34,6 44,6 L64,6 Q76,7 88,19 Z`} fill={shellDark} />
      <path d={`M33,17 Q38,9.5 45,9.5 L48,9.5 L48,17 Z`} fill={GLASS} />
      <path d={`M53,9.5 L62,9.5 Q72,10.5 81,17 L53,17 Z`} fill={GLASS} />
      {/* body: a slight wedge, low nose, short overhangs */}
      <path d={`M5,33 L5,24 Q5,18 13,18 L92,18 Q100,20 101,26 L101,33 Z`} fill={shell} />
      <rect x={5} y={28} width={96} height={5.5} rx={2.5} fill={shellDark} />
      {/* which way it is going: headlight at the nose, lamp at the tail */}
      <rect x={92} y={21} width={9} height={4.5} rx={2.25} fill={CREAM} opacity={0.95} />
      <rect x={5} y={21} width={5} height={4} rx={2} fill={taxi ? "#8f5f0f" : "#a83c34"} />
      {taxi ? (
        <>
          {/* the roof sign and a chequer along the sill — the two things that
              say taxi at a glance, and the only two that survive being drawn
              a hundred pixels wide */}
          <rect x={48} y={1} width={17} height={6} rx={1.5} fill={CREAM} />
          <rect x={48} y={5.5} width={17} height={1.5} fill={DARK} />
          {Array.from({ length: 9 }).map((_, i) => (
            <rect
              key={i}
              x={16 + i * 8}
              y={i % 2 ? 25 : 21.5}
              width={8}
              height={3.5}
              fill={DARK}
              opacity={0.75}
            />
          ))}
        </>
      ) : (
        <Titles x={39} y={27} size={6} fill="#f6c9c4" />
      )}
      <Wheel cx={26} cy={base} r={8} spin={spin} />
      <Wheel cx={80} cy={base} r={8} spin={spin} />
    </g>
  );
}

/**
 * A motorbike drawn as a motorbike: two wheels, a frame between them, and a
 * rider leaning into it.
 *
 * What was here was a circle, a blob and a horizontal bar — no frame, no
 * forks, no engine, and the rider's arm ended in mid-air where a handlebar
 * should have been.
 *
 * **Nobody is on it.** A rider was drawn here twice and thrown away twice: at
 * any weight that made a person legible they covered the machine, and the
 * whole job of this drawing is to say which machine. The party's own
 * likenesses are the figures on foot, and they are the only people the scene
 * draws.
 */
function Motorbike({ spin }: { spin: boolean }) {
  const base = 34;
  return (
    <g>
      {/* swingarm and fork, behind everything they carry */}
      <path d="M19,34 L34,28" stroke={METAL} strokeWidth={3.5} strokeLinecap="round" />
      <path d="M68,34 L58,13" stroke={METAL} strokeWidth={4} strokeLinecap="round" />
      {/* engine, and the pipe running back from it */}
      <rect x={30} y={22} width={16} height={10} rx={2.5} fill={DARK} />
      <rect x={17} y={28.5} width={23} height={3.5} rx={1.75} fill={METAL} />
      {/* tail, seat and tank — the line a bike is recognised by. The tank
          was a slab from the seat to the forks, wider than the engine and
          taller than the wheels, so it covered the frame it is supposed to
          sit on. It is the length between the seat and the steering head and
          no more. */}
      <path d="M16,21 L19,16 L25,16 L26,21 Z" fill={BODY_DARK} />
      <rect x={19} y={16} width={15} height={3} rx={1.5} fill={DARK} />
      <path d="M34,22 Q36,15 43,14.5 L53,17 L54,22 Z" fill={BODY} />
      {/* bars across the top of the fork, headlight in front of it — both
          used to float clear of the forks with nothing joining them on */}
      <path d="M52,14 L64,9.5" stroke={DARK} strokeWidth={3} strokeLinecap="round" />
      <circle cx={61.5} cy={15} r={3.4} fill={CREAM} />
      <Wheel cx={19} cy={base} r={10} spin={spin} />
      <Wheel cx={68} cy={base} r={10} spin={spin} />
    </g>
  );
}

/**
 * A bicycle: a diamond frame between two spoked wheels, and somebody on it.
 *
 * Every line here is one of the seven tubes a bicycle actually has — seat
 * tube, down tube, top tube, chainstay, seatstay, fork, bars — because the
 * first attempt drew a rough zigzag instead and the result was unreadable as
 * anything. A bicycle is a shape people know exactly; approximate it and it
 * reads as broken rather than as stylised.
 *
 * `Wheel`'s `spoked` look matters more here than anywhere: what separates a
 * bicycle from a small motorbike at this size is that you can see through
 * the wheels. Riderless, for the reason given on `Motorbike` above.
 */
function Bicycle({ spin }: { spin: boolean }) {
  const base = 31;
  return (
    <g>
      {/* The frame, all seven tubes: seat, down, top, chainstay, seatstay
          and the head tube. The head tube is the short one nobody draws and
          it is the one that matters — without it the top tube and the down
          tube each stop in mid-air and the front of the bicycle is two loose
          ends beside a wheel. */}
      <path
        d="M33,31 L28,11 M33,31 L54,17 M28,11 L52,10 M33,31 L17,31 M28,11 L17,31 M52,10 L54,17"
        fill="none"
        stroke={BODY}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* fork and bars */}
      <path d="M54,17 L58,31" stroke={METAL} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M52,10 L58,8" stroke={DARK} strokeWidth={2.4} strokeLinecap="round" />
      {/* saddle, and the cranks at the bottom bracket */}
      <rect x={22} y={8.5} width={11} height={2.6} rx={1.3} fill={DARK} />
      <circle cx={33} cy={31} r={2.6} fill={DARK} />
      <path d="M33,31 L37,34" stroke={METAL} strokeWidth={2} strokeLinecap="round" />
      <rect x={36} y={34} width={5} height={1.8} rx={0.9} fill={DARK} />
      <Wheel cx={17} cy={base} r={13} spin={spin} look="spoked" />
      <Wheel cx={58} cy={base} r={13} spin={spin} look="spoked" />
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
      <Titles x={26} y={38} size={7.5} fill="#f6c9c4" />
    </g>
  );
}

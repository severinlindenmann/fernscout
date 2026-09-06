"use client";

/**
 * A small illustrated skyline, sized to the place it names.
 *
 * The *shape* is derived from the location name, so somewhere looks consistent
 * every time it is drawn and unlike its neighbours. Two things are not from
 * the name, because a hash is not evidence about anywhere real:
 *
 * - **How big it is** comes from `population`, which `lib/tripView.ts` reads
 *   out of the GeoNames index already committed for reverse-geocoding photos.
 *   Before this every place got five to seven towers, so a hamlet in the Alps
 *   and Tokyo were drawn identically. Absent — no index built, mid-ocean, or a
 *   place the dump has no figure for — draws a modest town, which is the
 *   honest thing to render when nothing is known.
 * - **What grows there** comes from `lat`. There were two palm trees hard-
 *   coded into every skyline, so Reykjavík and Ulaanbaatar had them too.
 */

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALLS = ["#f4a259", "#5fb08a", "#e8746c", "#6ea8dc", "#f0c05a", "#b98adc"];
const ROOFS = ["#c9743a", "#3f8a68", "#c2544c", "#4a80ad", "#c99a35", "#8f66ad"];

type Building = {
  x: number;
  w: number;
  h: number;
  wall: string;
  roof: string;
  kind: "flat" | "pitched" | "spire" | "dome";
};

/**
 * A place's size on a 0–1 scale, from its population.
 *
 * Logarithmic, because population is: a village of 800 and a town of 8,000 is
 * the same visible step as a city of 800,000 and one of 8 million, and a
 * linear scale would draw every place under a million as the same hamlet.
 * 1,000 → 0 (the smallest entry GeoNames' `cities1000` carries) and 10 million
 * → 1.
 *
 * `undefined` lands at 0.35 — a small town. Not 0: an unknown place is not
 * evidence of a tiny one, and the fallback should be the shrug, not a claim.
 */
export function cityScale(population?: number): number {
  if (population === undefined || population < 1) return 0.35;
  return Math.min(1, Math.max(0, (Math.log10(population) - 3) / 4));
}

/** What grows at a latitude. Coarse on purpose — four bands, drawn from the
 * one number every day already carries. */
export type Flora = "palm" | "broadleaf" | "conifer" | "bare";

export function floraFor(lat?: number): Flora {
  if (lat === undefined || !Number.isFinite(lat)) return "broadleaf";
  const a = Math.abs(lat);
  if (a <= 23.5) return "palm";
  if (a <= 48) return "broadleaf";
  if (a <= 66.5) return "conifer";
  return "bare";
}

export default function Cityscape({
  name,
  population,
  lat,
  width = 260,
  height = 140,
  className,
}: {
  name: string;
  /** From the GeoNames index — see `cityScale`. */
  population?: number;
  /** Decides what is planted alongside — see `floraFor`. */
  lat?: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const rand = mulberry32(hashString(name));
  const scale = cityScale(population);
  const buildings: Building[] = [];

  // Three buildings for a village, twelve for a capital — and the tall ones
  // only appear where there are enough of them for a tall one to belong.
  const count = 3 + Math.round(scale * 9);
  // A hamlet's tallest building is a third of the frame; a metropolis fills it.
  const tallest = 30 + scale * (height - 56);
  const narrow = 20 + scale * 10;

  let x = 4;
  for (let i = 0; i < count && x < width - 16; i++) {
    const w = narrow + Math.floor(rand() * 16);
    const h = 26 + Math.floor(rand() * Math.max(12, tallest - 26));
    const ci = Math.floor(rand() * WALLS.length);
    const kindRoll = rand();
    // Spires and domes are civic buildings; a place too small to have one is
    // drawn without one rather than given a cathedral by the dice.
    const kind: Building["kind"] =
      kindRoll > 0.86 && scale > 0.45
        ? "spire"
        : kindRoll > 0.72 && scale > 0.3
          ? "dome"
          : kindRoll > 0.45
            ? "pitched"
            : "flat";
    buildings.push({ x, w, h, wall: WALLS[ci], roof: ROOFS[ci], kind });
    x += w + 4 + Math.floor(rand() * 7);
  }

  const baseY = height - 10;
  const flora = floraFor(lat);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      {buildings.map((b, i) => {
        const top = baseY - b.h;
        const cols = Math.max(2, Math.floor(b.w / 13));
        const rows = Math.max(2, Math.floor(b.h / 18));
        return (
          <g key={i}>
            {/* body */}
            <rect x={b.x} y={top} width={b.w} height={b.h} rx={3} fill={b.wall} />
            {/* roof treatments */}
            {b.kind === "pitched" && (
              <path
                d={`M${b.x - 3},${top + 1} L${b.x + b.w / 2},${top - 12} L${b.x + b.w + 3},${top + 1} Z`}
                fill={b.roof}
              />
            )}
            {b.kind === "dome" && (
              <path
                d={`M${b.x + 2},${top + 2} a${b.w / 2 - 2},${b.w / 2 - 2} 0 0 1 ${b.w - 4},0 Z`}
                fill={b.roof}
              />
            )}
            {b.kind === "spire" && (
              <>
                <rect x={b.x + b.w / 2 - 1.5} y={top - 16} width={3} height={16} fill={b.roof} />
                <circle cx={b.x + b.w / 2} cy={top - 18} r={3} fill={b.roof} />
              </>
            )}
            {b.kind === "flat" && (
              <rect x={b.x - 2} y={top - 4} width={b.w + 4} height={5} rx={2} fill={b.roof} />
            )}
            {/* windows */}
            {Array.from({ length: rows }).map((_, r) =>
              Array.from({ length: cols }).map((_, c) => {
                const wx = b.x + 6 + c * ((b.w - 10) / cols);
                const wy = top + 12 + r * ((b.h - 18) / rows);
                if (wy > baseY - 12) return null;
                const lit = rand() > 0.45;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={wx}
                    y={wy}
                    width={5.5}
                    height={7}
                    rx={1.2}
                    fill={lit ? "#fff8d8" : "#ffffff"}
                    opacity={lit ? 0.95 : 0.45}
                  />
                );
              }),
            )}
          </g>
        );
      })}

      {/* What grows here, from the latitude rather than from a preference for
          palm trees. `bare` plants nothing: above the treeline there is
          nothing to draw, and an empty verge says that. */}
      <Tree flora={flora} x={width - 26} baseY={baseY} scale={1} />
      <Tree flora={flora} x={width - 6} baseY={baseY} scale={0.78} />

      {/* ground line */}
      <rect x={-10} y={baseY} width={width + 20} height={12} fill="#cdeecb" />
    </svg>
  );
}

function Tree({
  flora,
  x,
  baseY,
  scale,
}: {
  flora: Flora;
  x: number;
  baseY: number;
  scale: number;
}) {
  if (flora === "bare") return null;
  if (flora === "broadleaf") {
    const h = 30 * scale;
    return (
      <g transform={`translate(${x}, ${baseY})`}>
        <rect x={-1.6 * scale} y={-h} width={3.2 * scale} height={h} rx={1.5} fill="#8a6a44" />
        <circle cx={0} cy={-h - 5 * scale} r={11 * scale} fill="#4a9c78" />
        <circle cx={-7 * scale} cy={-h + 1 * scale} r={7.5 * scale} fill="#3f8a68" />
        <circle cx={7 * scale} cy={-h + 1 * scale} r={7.5 * scale} fill="#3f8a68" />
      </g>
    );
  }
  if (flora === "conifer") {
    const h = 36 * scale;
    return (
      <g transform={`translate(${x}, ${baseY})`}>
        <rect x={-1.6 * scale} y={-8 * scale} width={3.2 * scale} height={8 * scale} fill="#8a6a44" />
        <path d={`M0,${-h} L${9 * scale},${-8 * scale} L${-9 * scale},${-8 * scale} Z`} fill="#3f8a68" />
        <path
          d={`M0,${-h + 8 * scale} L${11 * scale},${-2 * scale} L${-11 * scale},${-2 * scale} Z`}
          fill="#4a9c78"
        />
      </g>
    );
  }
  const h = 34 * scale;
  return (
    <g transform={`translate(${x}, ${baseY})`}>
      <path
        d={`M0,0 q-2,${-h / 2} 1,${-h}`}
        stroke="#8a6a44"
        strokeWidth={3.2 * scale}
        fill="none"
        strokeLinecap="round"
      />
      <g transform={`translate(1, ${-h})`}>
        <path d={`M0,0 q-13,-4 -17,4`} stroke="#3f8a68" strokeWidth={4 * scale} fill="none" strokeLinecap="round" />
        <path d={`M0,0 q13,-4 17,4`} stroke="#3f8a68" strokeWidth={4 * scale} fill="none" strokeLinecap="round" />
        <path d={`M0,0 q-6,-12 -14,-11`} stroke="#4a9c78" strokeWidth={4 * scale} fill="none" strokeLinecap="round" />
        <path d={`M0,0 q6,-12 14,-11`} stroke="#4a9c78" strokeWidth={4 * scale} fill="none" strokeLinecap="round" />
      </g>
    </g>
  );
}

"use client";

/**
 * A small illustrated skyline. Buildings get windows, roofs, spires and a few
 * palms/trees so the destination reads as a place rather than a bar chart.
 * The shape is derived from the location name, so each city looks consistent
 * every time it's drawn but different from its neighbours.
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

export default function Cityscape({
  name,
  width = 260,
  height = 140,
  className,
}: {
  name: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const rand = mulberry32(hashString(name));
  const buildings: Building[] = [];

  let x = 4;
  const count = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < count && x < width - 20; i++) {
    const w = 26 + Math.floor(rand() * 20);
    const h = 38 + Math.floor(rand() * (height - 62));
    const ci = Math.floor(rand() * WALLS.length);
    const kindRoll = rand();
    const kind: Building["kind"] =
      kindRoll > 0.86 ? "spire" : kindRoll > 0.72 ? "dome" : kindRoll > 0.45 ? "pitched" : "flat";
    buildings.push({ x, w, h, wall: WALLS[ci], roof: ROOFS[ci], kind });
    x += w + 5 + Math.floor(rand() * 8);
  }

  const baseY = height - 10;

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

      {/* a couple of palms for warmth */}
      <Palm x={width - 26} baseY={baseY} scale={1} />
      <Palm x={width - 6} baseY={baseY} scale={0.78} />

      {/* ground line */}
      <rect x={-10} y={baseY} width={width + 20} height={12} fill="#cdeecb" />
    </svg>
  );
}

function Palm({ x, baseY, scale }: { x: number; baseY: number; scale: number }) {
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

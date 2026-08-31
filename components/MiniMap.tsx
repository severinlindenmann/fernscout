"use client";

import { motion } from "motion/react";
import { project, MAP_VIEWBOX } from "@/lib/mapProjection";
import { useWorldLand } from "./useWorldLand";

/** A small "you are here" world map — the whole route faintly, with a pulsing
 * pin on where we are right now. */
export default function MiniMap({
  route,
  current,
  className,
}: {
  route: { lat: number; lng: number }[];
  current: { lat: number; lng: number };
  className?: string;
}) {
  const worldLand = useWorldLand();
  const pts = route.map((p) => project(p.lat, p.lng));
  const [cx, cy] = project(current.lat, current.lng);

  // Frame the route with padding, biased so the pin is comfortably inside.
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const padX = 90;
  const padY = 60;
  const minX = Math.max(0, Math.min(...xs, cx) - padX);
  const maxX = Math.min(MAP_VIEWBOX.width, Math.max(...xs, cx) + padX);
  const minY = Math.max(0, Math.min(...ys, cy) - padY);
  const maxY = Math.min(MAP_VIEWBOX.height, Math.max(...ys, cy) + padY);

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className={className}
      role="img"
      aria-hidden
    >
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#8fe0ef" />
      <g fill="#dff3e0" stroke="#bfe3c4" strokeWidth={0.6}>
        {worldLand.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {pts.length > 1 && (
        <polyline
          points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#1e293b"
          strokeOpacity={0.28}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 4"
        />
      )}

      {/* pulsing "we are here" pin — scale, not `r`: Motion can't interpolate
          SVG geometry attributes reliably. */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={9}
        fill="#ffd23f"
        initial={{ scale: 0.7, opacity: 0.45 }}
        animate={{ scale: [0.7, 1.9], opacity: [0.45, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
      />
      <circle cx={cx} cy={cy} r={5} fill="#ffd23f" stroke="#1e293b" strokeWidth={1.8} />
    </svg>
  );
}

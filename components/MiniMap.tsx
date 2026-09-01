"use client";

import { motion } from "motion/react";
import { frameRoute, place as placeIn } from "@/lib/mapFrame";
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
  // The pin is part of the route for framing purposes — it is the one point
  // that must never fall outside, and on a trip whose current position has run
  // ahead of its written days it is the outlier that decides the frame.
  const frame = frameRoute([...route, current]);
  const pts = route.map((p) => placeIn(frame, p));
  const [cx, cy] = placeIn(frame, current);

  return (
    <svg
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      className={className}
      role="img"
      aria-hidden
    >
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#8fe0ef" />
      {/* Squeezed, not positioned — see the same group in WorldMap. */}
      <g
        fill="#dff3e0"
        stroke="#bfe3c4"
        strokeWidth={0.6}
        transform={`scale(${frame.lngScale} 1)`}
      >
        {worldLand.map((d, i) => (
          <path key={i} d={d} vectorEffect="non-scaling-stroke" />
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

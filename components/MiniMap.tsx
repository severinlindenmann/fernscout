"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { frameRoute, isPlottable, place as placeIn } from "@/lib/mapFrame";
import { useWorldLand } from "./useWorldLand";
import type { Basemap } from "@/lib/basemap";

/** A small "you are here" map — the whole route faintly, with a pulsing pin on
 * where we are right now. */
export default function MiniMap({
  route,
  current,
  className,
  basemap = null,
}: {
  route: { lat: number; lng: number }[];
  current: { lat: number; lng: number };
  className?: string;
  /** Clipped to this route's frame on the server — see lib/basemap.ts. */
  basemap?: Basemap | null;
}) {
  const worldLand = useWorldLand();
  // The pin is part of the route for framing purposes — it is the one point
  // that must never fall outside, and on a trip whose current position has run
  // ahead of its written days it is the outlier that decides the frame.
  const frame = frameRoute([...route, current]);
  // A coordinate-less day (B265) is not a point: dropped from the polyline
  // rather than drawn as one. `current` itself is guarded separately below —
  // it is a single day, not a list to filter.
  const pts = route.filter(isPlottable).map((p) => placeIn(frame, p));
  const hasCurrent = isPlottable(current);
  const [cx, cy] = hasCurrent ? placeIn(frame, current) : [0, 0];

  /**
   * Sizes in screen pixels, for the reason WorldMap carries at length.
   *
   * This component had the bug in its purest form and kept it two commits
   * longer than the others: B46 gave it the shared frame but left its pin at
   * `r={9}` *viewBox units*. On the old fixed padding a frame was never
   * narrower than 140 units and that meant a dot; framed on `alps-2024` it is
   * 4.6 units, so the pin came out twice as wide as the entire map and the
   * trip hero rendered as a solid yellow rectangle.
   */
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drawnWidth, setDrawnWidth] = useState(600);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setDrawnWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const px = (pixels: number) => (pixels * frame.w) / drawnWidth;

  return (
    <svg
      ref={svgRef}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      className={className}
      role="img"
      aria-hidden
    >
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#8fe0ef" />
      {/* Squeezed, not positioned — see the same group in WorldMap. */}
      <g transform={`scale(${frame.lngScale} 1)`}>
        {basemap ? (
          <>
            <g fill="#dff3e0" stroke="#94c9a0" strokeWidth={1}>
              {basemap.borders.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            <g fill="#cfe0bd" opacity={0.55} stroke="none">
              {basemap.relief.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <g fill="#8fe0ef" stroke="#6fcfe0" strokeWidth={0.7}>
              {basemap.lakes.map((d, i) => (
                <path key={i} d={d} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </>
        ) : (
          <g fill="#dff3e0" stroke="#bfe3c4" strokeWidth={1}>
            {worldLand.map((d, i) => (
              <path key={i} d={d} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}
      </g>

      {pts.length > 1 && (
        <polyline
          points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="#1e293b"
          strokeOpacity={0.28}
          strokeWidth={px(3)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${px(7)} ${px(7)}`}
        />
      )}

      {/* pulsing "we are here" pin — scale, not `r`: Motion can't interpolate
          SVG geometry attributes reliably. Withheld rather than drawn at
          (0, 0) when `current` itself has no coordinates (B265) — a pin on
          the map's corner would read as a place, and it is not one. */}
      {hasCurrent && (
        <>
          <motion.circle
            cx={cx}
            cy={cy}
            r={px(16)}
            fill="#ffd23f"
            initial={{ scale: 0.7, opacity: 0.45 }}
            animate={{ scale: [0.7, 1.9], opacity: [0.45, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
          <circle cx={cx} cy={cy} r={px(9)} fill="#ffd23f" stroke="#1e293b" strokeWidth={px(3)} />
        </>
      )}
    </svg>
  );
}

"use client";

import { useMemo } from "react";
import Image from "next/image";
import { place as placeIn, type Frame } from "@/lib/mapFrame";
import { mediaLoader } from "./../mediaLoader";
import { useI18n } from "../LocaleProvider";
import type { PhotoPin } from "@/lib/map/photoPins";

/**
 * Round thumbnail pins at a photograph's real position (B-2980), drawn inside
 * `WorldMap`'s SVG. A thin tether joins a pin to the recorded route when the
 * server found one within 150 m. Pins that would overlap become one badge.
 * ponytail: greedy clustering, no re-cluster on zoom beyond `px`; fine for a day's photos.
 */
export default function PhotoPins({
  pins,
  base,
  px,
  onOpen,
}: {
  pins: PhotoPin[];
  base: Frame;
  px: (pixels: number) => number;
  onOpen: (group: PhotoPin[]) => void;
}) {
  const label = useI18n().t("map.photoPin");
  const r = px(11);
  const groups = useMemo(() => {
    const out: { x: number; y: number; pins: PhotoPin[] }[] = [];
    for (const pin of pins) {
      const [x, y] = placeIn(base, pin);
      const hit = out.find((g) => Math.hypot(g.x - x, g.y - y) < r * 2);
      if (hit) hit.pins.push(pin);
      else out.push({ x, y, pins: [pin] });
    }
    return out;
  }, [pins, base, r]);

  return (
    <g>
      {groups.map((g, i) => (
        <g key={i}>
          {g.pins.map((p, j) => {
            if (!p.tether) return null;
            const [tx, ty] = placeIn(base, { lat: p.tether[0], lng: p.tether[1] });
            return <line key={j} x1={g.x} y1={g.y} x2={tx} y2={ty} stroke="#5a6a80" strokeWidth={px(1)} pointerEvents="none" />;
          })}
          <g
            role="button"
            tabIndex={0}
            aria-label={g.pins[0].item.caption ?? g.pins[0].item.alt ?? label}
            style={{ cursor: "pointer" }}
            onClick={() => onOpen(g.pins)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(g.pins);
              }
            }}
          >
            <circle cx={g.x} cy={g.y} r={r} fill="#fff" stroke="#fff" strokeWidth={px(2)} />
            <foreignObject x={g.x - r} y={g.y - r} width={r * 2} height={r * 2}>
              <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden" }}>
                <Image src={g.pins[0].item.src} loader={mediaLoader} alt="" fill sizes="48px" className="object-cover" />
              </div>
            </foreignObject>
            {g.pins.length > 1 && (
              <>
                <circle cx={g.x + r * 0.8} cy={g.y - r * 0.8} r={px(7)} fill="#1b2a41" />
                <text x={g.x + r * 0.8} y={g.y - r * 0.8} fontSize={px(9)} fill="#fff" textAnchor="middle" dominantBaseline="central">
                  {g.pins.length}
                </text>
              </>
            )}
          </g>
        </g>
      ))}
    </g>
  );
}

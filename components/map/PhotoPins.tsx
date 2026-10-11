"use client";

import { useId, useMemo, useState } from "react";
import { place as placeIn, type Frame } from "@/lib/mapFrame";
import { mediaLoader } from "./../mediaLoader";
import { groupByScreen } from "@/lib/map/pinGroups";
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
  const groups = useMemo(
    () =>
      groupByScreen(
        pins.map((pin) => {
          const [x, y] = placeIn(base, pin);
          return { x, y, pin };
        }),
        r * 2,
      ).map((g) => ({ x: g[0].x, y: g[0].y, pins: g.map((m) => m.pin) })),
    [pins, base, r],
  );

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
            <PinThumb x={g.x} y={g.y} r={r} ring={px(2)} src={g.pins[0].item.src} />
            <circle cx={g.x} cy={g.y} r={px(22)} fill="transparent" />
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

/** The photo as a round thumbnail with a white ring; a camera dot if it will not load.
 * A plain SVG image: next/image inside foreignObject never loaded (lazy, no
 * intersection in a foreignObject), which left the pins blank. */
function PinThumb({ x, y, r, ring, src }: { x: number; y: number; r: number; ring: number; src: string }) {
  const clip = useId();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <circle cx={x} cy={y} r={r + ring / 2} fill="#fff" />
      {failed ? (
        <circle cx={x} cy={y} r={r * 0.45} fill="#1b2a41" />
      ) : (
        <>
          <clipPath id={clip}>
            <circle cx={x} cy={y} r={r} />
          </clipPath>
          <image
            href={mediaLoader({ src, width: 96 })}
            x={x - r}
            y={y - r}
            width={r * 2}
            height={r * 2}
            clipPath={`url(#${clip})`}
            preserveAspectRatio="xMidYMid slice"
            onError={() => setFailed(true)}
          />
        </>
      )}
    </>
  );
}

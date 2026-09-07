"use client";

import { useRef, useState } from "react";
import { CENTRE, zoomInto } from "@/lib/postcard/crop";
import type { Crop } from "@/lib/postcard/orders";

/**
 * The front photograph, cropped within a fixed landscape frame — B627.
 *
 * Two gestures and no more. **Drag a rectangle** over the part that should
 * stay on the card and the frame becomes that rectangle; **arrow keys** move
 * the same crop about without changing how close it is. A rectangle is drawn
 * at the card's own aspect (`aspect`, from `backLayout`) whatever shape it is
 * dragged in, so there is nothing here that could scale the photograph
 * anisotropically — it stays the cover-crop `lib/postcard/render.ts` draws,
 * moved and scaled by one factor on both axes.
 *
 * **Reset undoes all of it in one press**, which is what makes dragging safe
 * to try: zooming in is easy to overdo and there is no gesture that zooms out
 * a little, on purpose — one honest way back beats two confusable ways.
 *
 * Saves through `POST …/postcards/<id>/crop` on release, which is the same
 * `Crop` (B513's fraction pair, plus `zoom`) that `renderPostcard` reads at
 * send — so what is dragged here is what prints, not a preview of something
 * else.
 */
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export default function PostcardCropper({
  username,
  id,
  src,
  aspect,
  initial,
  editable,
  hint,
  savingLabel,
  resetLabel,
}: {
  username: string;
  id: string;
  src: string;
  aspect: string;
  initial: Crop;
  editable: boolean;
  hint: string;
  savingLabel: string;
  resetLabel: string;
}) {
  const [crop, setCrop] = useState<Crop>(initial);
  const [saving, setSaving] = useState(false);
  // The rectangle being dragged, in fractions of the frame — null when not.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const zoom = crop.zoom ?? 1;

  function fromPoint(clientX: number, clientY: number) {
    const box = boxRef.current!.getBoundingClientRect();
    return { x: clamp((clientX - box.left) / box.width), y: clamp((clientY - box.top) / box.height) };
  }

  /** The dragged rectangle, forced to the card's aspect and kept in frame. */
  function rectTo(clientX: number, clientY: number) {
    const from = start.current!;
    const at = fromPoint(clientX, clientY);
    // One number for both sides: a fraction of the frame's width and a
    // fraction of its height describe the same shape as the frame, so a
    // square in fractions is the card's own aspect on screen. That is why
    // nothing here can come out stretched.
    const size = Math.min(1, Math.max(Math.abs(at.x - from.x), Math.abs(at.y - from.y)));
    const corner = (a: number, b: number) => Math.min(Math.max(b < a ? a - size : a, 0), 1 - size);
    return { x: corner(from.x, at.x), y: corner(from.y, at.y), w: size, h: size };
  }

  function save(next: Crop) {
    setCrop(next);
    setSaving(true);
    fetch(`/${username}/postcards/${id}/crop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
      .catch(() => {})
      .finally(() => setSaving(false));
  }

  // `object-cover` already places the anchor point of the photograph at the
  // same fraction across the frame; scaling about that same point is exactly
  // what `coverRect` does with `zoom`, so the two agree by construction
  // rather than by two rederivations that happen to match.
  const imageStyle = {
    objectPosition: `${crop.x * 100}% ${crop.y * 100}%`,
    transform: zoom === 1 ? undefined : `scale(${zoom})`,
    transformOrigin: `${crop.x * 100}% ${crop.y * 100}%`,
  };

  if (!editable) {
    return (
      <div className="relative overflow-hidden rounded" style={{ aspectRatio: aspect }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- see page.tsx: the
            frame is exactly the card, in millimetres. */}
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={imageStyle} />
      </div>
    );
  }

  const STEP = 0.05;

  return (
    <div>
      <div
        ref={boxRef}
        // Not `role="slider"`: this is a two-axis position and a scale, and
        // ARIA has no role for that — a screen reader announcing one number
        // for a control that carries three would be worse than announcing
        // none. The status line below is the accessible readout instead.
        aria-label={hint}
        tabIndex={0}
        className="relative block w-full touch-none select-none overflow-hidden rounded border border-navy-300 focus-visible:ring-2 focus-visible:ring-yellow-400"
        style={{ aspectRatio: aspect, cursor: "crosshair" }}
        onPointerDown={(e) => {
          start.current = fromPoint(e.clientX, e.clientY);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setMarquee(rectTo(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          if (!start.current) return;
          const rect = rectTo(e.clientX, e.clientY);
          start.current = null;
          setMarquee(null);
          // A tap is not a tiny rectangle. Zooming to a few pixels because
          // somebody clicked the picture is the one outcome nobody meant.
          if (rect.w < 0.05) return;
          const nx = zoomInto(crop.x, zoom, rect.x, rect.w);
          const ny = zoomInto(crop.y, zoom, rect.y, rect.h);
          save({ x: nx.anchor, y: ny.anchor, zoom: Math.min(nx.zoom, ny.zoom) });
        }}
        onKeyDown={(e) => {
          let next: Crop | null = null;
          if (e.key === "ArrowLeft") next = { ...crop, x: clamp(crop.x - STEP) };
          else if (e.key === "ArrowRight") next = { ...crop, x: clamp(crop.x + STEP) };
          else if (e.key === "ArrowUp") next = { ...crop, y: clamp(crop.y - STEP) };
          else if (e.key === "ArrowDown") next = { ...crop, y: clamp(crop.y + STEP) };
          if (!next) return;
          e.preventDefault();
          save(next);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the print
            geometry is in millimetres and the frame here is exactly the
            card; next/image would impose its own box on it. */}
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={imageStyle}
        />
        {marquee && (
          <span
            aria-hidden
            className="pointer-events-none absolute border-2 border-yellow-400 bg-navy-900/20"
            style={{
              left: `${marquee.x * 100}%`,
              top: `${marquee.y * 100}%`,
              width: `${marquee.w * 100}%`,
              height: `${marquee.h * 100}%`,
            }}
          />
        )}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="text-xs opacity-70" role="status">
          {saving ? savingLabel : hint}
        </p>
        <button
          type="button"
          onClick={() => save(CENTRE)}
          className="shrink-0 text-xs font-semibold text-navy-600 underline"
        >
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

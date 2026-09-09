"use client";

import { useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { MAX_CROP_ZOOM } from "@/lib/postcard/spec";
import type { Crop } from "@/lib/postcard/orders";

/**
 * The front photograph, cropped within a fixed landscape frame — B627.
 *
 * **Drag the photograph to move it; the slider says how close.** Both work
 * with one thumb, which is the point: this began as a dragged rectangle and
 * that gesture failed on the surface it matters on. On a phone there are no
 * arrow keys, and drawing an accurate rectangle over a picture already
 * cropped to the card means aiming at the part you cannot see — every drag
 * could only ever go *closer in*, so overshooting meant starting over.
 *
 * A slider is the native control for one number with a floor and a ceiling
 * (`<input type="range">` — no library, keyboard and screen reader support
 * for free), and dragging to pan is what everybody's photo app already does.
 * The zoom multiplies the cover scale on both axes at once, so nothing here
 * can stretch a photograph; it stays the cover-crop
 * `lib/postcard/render.ts` draws, moved and scaled.
 *
 * **Reset undoes all of it in one press.** Unlike the rectangle this is not
 * the only way back — the slider returns on its own — but it is the one press
 * that answers "I have made a mess of this".
 *
 * Saves through `POST …/postcards/<id>/crop` on release, which is the same
 * `Crop` (B513's fraction pair, plus `zoom`) that `renderPostcard` reads at
 * send — so what is dragged here is what prints, not a preview of something
 * else.
 */
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const CENTRE: Crop = { x: 0.5, y: 0.5, zoom: 1 };

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
  zoomLabel,
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
  zoomLabel: string;
}) {
  const [crop, setCrop] = useState<Crop>(initial);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Where the finger was last seen, in fractions of the frame. */
  const last = useRef<{ x: number; y: number } | null>(null);

  const zoom = crop.zoom ?? 1;

  function fromPoint(clientX: number, clientY: number) {
    const box = boxRef.current!.getBoundingClientRect();
    return {
      x: (clientX - box.left) / box.width,
      y: (clientY - box.top) / box.height,
    };
  }

  /**
   * Move the crop by a drag. The photograph follows the finger, so the anchor
   * goes the other way — dragging right shows more of the left of the picture.
   * One frame-width of drag walks the anchor across its whole range, divided
   * by the zoom so that a closer crop moves in smaller steps rather than
   * flinging the picture past what you were aiming at.
   */
  function panBy(dx: number, dy: number) {
    setCrop((c) => {
      const z = c.zoom ?? 1;
      return { ...c, x: clamp(c.x - dx / z), y: clamp(c.y - dy / z) };
    });
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
      <div
        className="relative overflow-hidden rounded"
        style={{ aspectRatio: aspect }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- see page.tsx: the
            frame is exactly the card, in millimetres. */}
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={imageStyle}
        />
      </div>
    );
  }

  const STEP = 0.05;

  return (
    <div>
      <div
        ref={boxRef}
        // Not `role="slider"`: this surface is a two-axis position, and ARIA
        // has no slider role for that — one number announced for a control
        // carrying two would be worse than none. The zoom, which *is* one
        // number, has a real slider of its own below.
        aria-label={hint}
        tabIndex={0}
        className="relative block w-full touch-none select-none overflow-hidden rounded border border-navy-300 focus-visible:ring-2 focus-visible:ring-yellow-400"
        style={{ aspectRatio: aspect, cursor: "grab" }}
        onPointerDown={(e) => {
          last.current = fromPoint(e.clientX, e.clientY);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const at = fromPoint(e.clientX, e.clientY);
          panBy(at.x - last.current.x, at.y - last.current.y);
          last.current = at;
        }}
        // Saved on release rather than on every frame: a drag is one decision,
        // and a POST per pointer event would be a hundred of them.
        onPointerUp={() => {
          if (!last.current) return;
          last.current = null;
          save(crop);
        }}
        onPointerCancel={() => {
          last.current = null;
        }}
        onKeyDown={(e) => {
          let next: Crop | null = null;
          if (e.key === "ArrowLeft")
            next = { ...crop, x: clamp(crop.x - STEP) };
          else if (e.key === "ArrowRight")
            next = { ...crop, x: clamp(crop.x + STEP) };
          else if (e.key === "ArrowUp")
            next = { ...crop, y: clamp(crop.y - STEP) };
          else if (e.key === "ArrowDown")
            next = { ...crop, y: clamp(crop.y + STEP) };
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
      </div>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={MAX_CROP_ZOOM}
          step={0.05}
          value={zoom}
          aria-label={zoomLabel}
          // While the thumb is moving this only redraws; the save waits for
          // release, the same bargain the drag makes.
          onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
          onPointerUp={() => save(crop)}
          onKeyUp={() => save(crop)}
          className="h-6 min-w-0 flex-1 accent-yellow-500"
        />
        <BusyButton
          busy={saving}
          type="button"
          onClick={() => save(CENTRE)}
          className="shrink-0 rounded-full border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-700 transition-colors hover:bg-cream-100 disabled:opacity-60"
        >
          {resetLabel}
        </BusyButton>
      </div>
      <p className="mt-1 text-xs opacity-70" role="status">
        {saving ? savingLabel : hint}
      </p>
    </div>
  );
}

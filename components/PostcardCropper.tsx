"use client";

import { useRef, useState } from "react";
import type { Crop } from "@/lib/postcard/orders";

/**
 * The front photograph, draggable within a fixed landscape frame — B627.
 *
 * Not a full editor: panning is the whole of it. The frame's aspect is fixed
 * to the card's own (`aspect`, from `backLayout`), so there is nothing here
 * that could scale the photograph anisotropically — that stays exactly the
 * cover-crop `lib/postcard/render.ts` already drew, only moved.
 *
 * Saves through `POST …/postcards/<id>/crop` on release, which is the same
 * fraction pair (`Crop`, B513's shape reused) that `renderPostcard` reads at
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
}: {
  username: string;
  id: string;
  src: string;
  aspect: string;
  initial: Crop;
  editable: boolean;
  hint: string;
  savingLabel: string;
}) {
  const [crop, setCrop] = useState<Crop>(initial);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function fromPoint(clientX: number, clientY: number): Crop {
    const box = boxRef.current!.getBoundingClientRect();
    return { x: clamp((clientX - box.left) / box.width), y: clamp((clientY - box.top) / box.height) };
  }

  function save(next: Crop) {
    setSaving(true);
    fetch(`/${username}/postcards/${id}/crop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
      .catch(() => {})
      .finally(() => setSaving(false));
  }

  const objectPosition = `${crop.x * 100}% ${crop.y * 100}%`;

  if (!editable) {
    return (
      <div className="relative overflow-hidden rounded" style={{ aspectRatio: aspect }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- see page.tsx: the
            frame is exactly the card, in millimetres. */}
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition }} />
      </div>
    );
  }

  const STEP = 0.05;

  return (
    <div>
      <div
        ref={boxRef}
        // Not `role="slider"`: this is a two-axis position, and ARIA has no
        // slider role for that — a screen reader announcing one number for a
        // control that carries two would be worse than announcing none. The
        // status line below is the accessible readout instead.
        aria-label={hint}
        tabIndex={0}
        className="relative block w-full touch-none select-none overflow-hidden rounded border border-navy-300 focus-visible:ring-2 focus-visible:ring-yellow-400"
        style={{ aspectRatio: aspect, cursor: "move" }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setCrop(fromPoint(e.clientX, e.clientY));
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          setCrop(fromPoint(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          save(fromPoint(e.clientX, e.clientY));
        }}
        onKeyDown={(e) => {
          let next: Crop | null = null;
          if (e.key === "ArrowLeft") next = { x: clamp(crop.x - STEP), y: crop.y };
          else if (e.key === "ArrowRight") next = { x: clamp(crop.x + STEP), y: crop.y };
          else if (e.key === "ArrowUp") next = { x: crop.x, y: clamp(crop.y - STEP) };
          else if (e.key === "ArrowDown") next = { x: crop.x, y: clamp(crop.y + STEP) };
          if (!next) return;
          e.preventDefault();
          setCrop(next);
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
          style={{ objectPosition }}
        />
      </div>
      <p className="mt-1 text-xs opacity-70" role="status">
        {saving ? savingLabel : hint}
      </p>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

interface Pan {
  x: number;
  y: number;
}

/** The minimal shape every map's own derived viewBox already has. */
interface ViewportFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface UseMapViewportOptions {
  /** The `<svg>` the gestures are read from — only ever measured, never
   * mutated, so the caller keeps drawing it exactly as before. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** How far in a gesture (pinch, wheel, double-tap, keyboard) may zoom. The
   * existing zoom-in/out buttons keep whatever cap they already had — this
   * hook only clamps the gestures it adds. */
  maxZoom: number;
  minZoom?: number;
  /**
   * Embedded mode (B2419, the trip-page map): one finger scrolls the page
   * rather than panning the map — `touchAction` below is what makes the
   * browser do that — two fingers pinch and pan as usual, and a single tap
   * asks `onRequestFullscreen` rather than doing anything to the map itself.
   * The map page itself is not cooperative: every finger is the map's.
   */
  cooperative?: boolean;
  onRequestFullscreen?: () => void;
}

export interface MapViewport {
  zoom: number;
  pan: Pan;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<Pan>>;
  /** Back to zoom 1, no pan — the same "reset view" every map already had. */
  reset: () => void;
  /** Whether the reader has moved off the automatic bounds. */
  moved: boolean;
  /**
   * Hands the hook the viewBox actually drawn this render, so a gesture that
   * fires between renders (a pinch, a wheel tick) reads the frame the reader
   * is actually looking at rather than a stale one. Call this once, in the
   * component body, with the same `frame` passed to the `<svg>` — a plain ref
   * write, safe to call on every render.
   */
  syncFrame: (frame: ViewportFrame) => void;
  /** Spread onto the `<svg>`. */
  bind: {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerLeave: (e: ReactPointerEvent<SVGSVGElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<SVGSVGElement>) => void;
    tabIndex: number;
  };
  /**
   * `touch-action` for the `<svg>`'s style/class: `none` so a one-finger drag
   * pans rather than scrolling the page (the map page's existing behaviour),
   * `pan-y` in cooperative mode so a single finger scrolls the page and only
   * a second finger's pinch is handled here.
   */
  touchAction: "none" | "pan-y";
}

type DragState = { id: number; x: number; y: number; panX: number; panY: number };
type PinchState = { startDist: number; startZoom: number };
type TapState = { id: number; x: number; y: number; moved: boolean; control: boolean };

/**
 * The pan/zoom state and pointer handling `TripMap` and `WorldMap` each used
 * to carry on their own (B2419's own why — see docs/plans/map-redesign.md
 * §3). One `{ zoom, pan }`, clamped to a caller-supplied `maxZoom`, driven by:
 *
 * - a one-pointer drag (mouse always; touch only when not `cooperative`)
 * - two-pointer pinch, zoomed around the pinch midpoint
 * - the wheel, `ctrlKey` included — trackpad pinch arrives as a wheel event
 *   with `ctrlKey` set and a `deltaY` that is a change of scale, not a
 *   scroll amount, which is the signal every pinch-to-zoom-on-wheel
 *   implementation reads
 * - a double-tap or double-click, zoomed around the tap
 * - the keyboard, once the map has focus: `+`/`=` and `-` zoom, the arrows
 *   pan, `0` fits the whole trip again
 *
 * `zoomAt` is the one piece of maths every gesture above shares: it keeps
 * whatever viewBox point sits under the gesture's anchor exactly where it
 * was, by shrinking or growing the *current* frame about its own centre.
 * That deliberately asks nothing of how the caller's own frame is built —
 * `TripMap` grows its base frame to the panel's aspect before dividing by
 * zoom, `WorldMap` drifts its centre toward the trip's stops as it zooms —
 * because `pan.x`/`pan.y` are always added on top of whatever the caller's
 * frame otherwise is, in both. Anchored at the frame's own centre (as the
 * existing zoom buttons and the keyboard both do), the pan delta is zero:
 * this hook does not change what a plain zoom in/out already did.
 */
export function useMapViewport({
  svgRef,
  maxZoom,
  minZoom = 1,
  cooperative = false,
  onRequestFullscreen,
}: UseMapViewportOptions): MapViewport {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });

  // Read by every handler below, always the latest render's values — a
  // pointer or wheel event fires after the DOM has committed, never during
  // it, so an effect-synced ref is exactly as current as `zoom` state would
  // be, without asking every handler to be re-created whenever it changes.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const frameRef = useRef<ViewportFrame>({ x: 0, y: 0, w: 1, h: 1 });
  const syncFrame = useCallback((frame: ViewportFrame) => {
    frameRef.current = frame;
  }, []);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<DragState | null>(null);
  const pinch = useRef<PinchState | null>(null);
  const tap = useRef<TapState | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /**
   * Zoom to `nextZoom`, keeping the viewBox point under `(clientX, clientY)`
   * where it already was. See the doc comment above for why this needs
   * nothing from the caller but the frame it already computed.
   */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextZoomRaw: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const nextZoom = clamp(nextZoomRaw, minZoom, maxZoom);
      const frame = frameRef.current;
      const fracX = (clientX - rect.left) / rect.width;
      const fracY = (clientY - rect.top) / rect.height;
      const worldX = frame.x + fracX * frame.w;
      const worldY = frame.y + fracY * frame.h;
      const ratio = zoomRef.current / nextZoom; // new width = old width * ratio
      const newW = frame.w * ratio;
      const newH = frame.h * ratio;
      const centerX = frame.x + frame.w / 2;
      const centerY = frame.y + frame.h / 2;
      const dPanX = worldX - (centerX - newW / 2 + fracX * newW);
      const dPanY = worldY - (centerY - newH / 2 + fracY * newH);
      setZoom(nextZoom);
      setPan((p) => ({ x: p.x + dPanX, y: p.y + dPanY }));
    },
    [svgRef, minZoom, maxZoom],
  );

  const handleTap = useCallback(
    (t: TapState, pointerType: string) => {
      if (t.control) return; // a marker's own click/keydown handles this
      if (cooperative && pointerType === "touch") {
        onRequestFullscreen?.();
        lastTap.current = null;
        return;
      }
      const now = Date.now();
      const last = lastTap.current;
      const isDouble =
        !!last &&
        now - last.time < DOUBLE_TAP_MS &&
        Math.hypot(t.x - last.x, t.y - last.y) < TAP_SLOP_PX * 2;
      if (isDouble) {
        lastTap.current = null;
        zoomAt(t.x, t.y, zoomRef.current * 2);
      } else {
        lastTap.current = { time: now, x: t.x, y: t.y };
      }
    },
    [cooperative, onRequestFullscreen, zoomAt],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      const control = !!target.closest?.('[role="button"], button, a');
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2) {
        drag.current = null;
        tap.current = null;
        const pts = [...pointers.current.values()];
        pinch.current = {
          startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
          startZoom: zoomRef.current,
        };
        return;
      }

      tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, control };

      // Cooperative mode: a single touch does not belong to the map, the
      // page scrolls under it — `touchAction` below is what tells the
      // browser that. Mouse always drags, on either map.
      if (cooperative && e.pointerType === "touch") return;

      // A pointer a browser no longer considers "active" (a synthetic event,
      // a stale id after a fast tap) throws here rather than no-opping —
      // never worth losing the drag over.
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [cooperative, pan.x, pan.y],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2 && pinch.current) {
        const pts = [...pointers.current.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const nextZoom = (pinch.current.startZoom * dist) / pinch.current.startDist;
        zoomAt(mid.x, mid.y, nextZoom);
        return;
      }

      if (tap.current?.id === e.pointerId) {
        const dx = e.clientX - tap.current.x;
        const dy = e.clientY - tap.current.y;
        if (Math.hypot(dx, dy) > TAP_SLOP_PX) tap.current.moved = true;
      }

      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const scale = frameRef.current.w / rect.width;
      setPan({
        x: d.panX - (e.clientX - d.x) * scale,
        y: d.panY - (e.clientY - d.y) * scale,
      });
    },
    [svgRef, zoomAt],
  );

  const endPointer = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (drag.current?.id === e.pointerId) drag.current = null;
      const t = tap.current;
      if (t?.id === e.pointerId) {
        tap.current = null;
        if (!t.moved) handleTap(t, e.pointerType);
      }
    },
    [handleTap],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<SVGSVGElement>) => {
      const frame = frameRef.current;
      const rect = svgRef.current?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : 0;
      const centerY = rect ? rect.top + rect.height / 2 : 0;
      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          zoomAt(centerX, centerY, zoomRef.current * 1.6);
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomAt(centerX, centerY, zoomRef.current / 1.6);
          break;
        case "0":
          e.preventDefault();
          reset();
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          // A step is a fraction of what's currently on screen, so it keeps
          // meaning "move a bit" whether the trip is a valley or a continent.
          const step = 0.12;
          const dx = e.key === "ArrowLeft" ? -frame.w * step : e.key === "ArrowRight" ? frame.w * step : 0;
          const dy = e.key === "ArrowUp" ? -frame.h * step : e.key === "ArrowDown" ? frame.h * step : 0;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
          break;
        }
        default:
          return;
      }
    },
    [svgRef, zoomAt, reset],
  );

  const onPointerLeave = endPointer;

  // Attached natively rather than through JSX `onWheel`: React's synthetic
  // wheel listener is registered passive, so `preventDefault` inside it is a
  // silent no-op and the page scrolls under the map anyway. `ctrlKey` is the
  // signal a trackpad pinch arrives as — Chrome and Safari both turn a
  // two-finger pinch on a trackpad into wheel events with `ctrlKey: true` and
  // a `deltaY` that means "change of scale", not "scroll this many pixels",
  // which is why its step is scaled differently from a plain wheel notch.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : Math.exp(-e.deltaY * 0.002);
      zoomAt(e.clientX, e.clientY, zoomRef.current * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, zoomAt]);

  const bind = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onPointerLeave,
      onKeyDown,
      tabIndex: 0,
    }),
    [onPointerDown, onPointerMove, endPointer, onPointerLeave, onKeyDown],
  );

  const moved = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  return {
    zoom,
    pan,
    setZoom,
    setPan,
    reset,
    moved,
    syncFrame,
    bind,
    touchAction: cooperative ? "pan-y" : "none",
  };
}

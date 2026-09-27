// @vitest-environment jsdom
import { act } from "react";
import { useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useMapViewport } from "@/components/map/useMapViewport";

/**
 * The pan/zoom state and gesture handling `TripMap` and `WorldMap` both used
 * to carry on their own, extracted for B2419 — see
 * docs/plans/map-redesign.md §3, Phase 0 item 3.
 *
 * This drives the hook through a minimal `<svg>`, the same shape either
 * component hands it: a viewBox derived from `zoom`/`pan` around a fixed
 * 100x100 base frame centred on the origin, `syncFrame` called every render
 * so gestures fired between renders read the frame that is actually on
 * screen — exactly what `TripMap` and `WorldMap` now do.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

type Reported = { zoom: number; pan: { x: number; y: number } };

function Harness({
  cooperative = false,
  onRequestFullscreen,
  onState,
}: {
  cooperative?: boolean;
  onRequestFullscreen?: () => void;
  onState?: (state: Reported) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewport = useMapViewport({ svgRef, maxZoom: 8, cooperative, onRequestFullscreen });
  const w = 100 / viewport.zoom;
  const h = 100 / viewport.zoom;
  const frame = { x: -w / 2 + viewport.pan.x, y: -h / 2 + viewport.pan.y, w, h };
  viewport.syncFrame(frame);
  onState?.({ zoom: viewport.zoom, pan: viewport.pan });
  return (
    <svg
      ref={svgRef}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
      style={{ touchAction: viewport.touchAction }}
      data-testid="map"
      {...viewport.bind}
    >
      <g role="button" tabIndex={0} data-testid="marker" />
    </svg>
  );
}

/** A 200x200 square at the origin — matches the frame the harness computes. */
function stubRect(el: Element) {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function render(props: Parameters<typeof Harness>[0] = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness {...props} />);
  });
  const svg = container.querySelector("svg")!;
  stubRect(svg);
  // jsdom does not implement pointer capture; a real browser would, but the
  // hook only needs it to not throw.
  (svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  return svg;
}

function down(el: Element, id: number, x: number, y: number, type = "touch") {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: id, clientX: x, clientY: y, pointerType: type }),
    );
  });
}
function move(el: Element, id: number, x: number, y: number, type = "touch") {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: id, clientX: x, clientY: y, pointerType: type }),
    );
  });
}
function up(el: Element, id: number, x: number, y: number, type = "touch") {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: id, clientX: x, clientY: y, pointerType: type }),
    );
  });
}

describe("two-pointer pinch", () => {
  test("spreading two touches apart zooms in, around their midpoint", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    // Both fingers land either side of the map's centre (100,100 in a
    // 200x200 rect) — the midpoint is the centre, so the anchor math is
    // trivially checkable: panning should stay near zero.
    down(svg, 1, 80, 100);
    down(svg, 2, 120, 100);
    move(svg, 1, 60, 100);
    move(svg, 2, 140, 100);
    const last = states.at(-1)!;
    expect(last.zoom).toBeGreaterThan(1);
    // Anchored at the centre: pan stays small. Each finger's `pointermove`
    // arrives as its own event even when both move together, so the anchor
    // is briefly recomputed from one finger's new position and the other's
    // old one — the same intermediate jitter any two-touch gesture has
    // between individual browser events, and why this is a tolerance rather
    // than an exact zero.
    expect(Math.abs(last.pan.x)).toBeLessThan(3);
    expect(Math.abs(last.pan.y)).toBeLessThan(3);
  });

  test("pinching apart off-centre keeps that point under the fingers, not the map centre", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    // Midpoint at (150, 100) — a quarter of the way from the right edge,
    // away from the map's own centre.
    down(svg, 1, 140, 100);
    down(svg, 2, 160, 100);
    move(svg, 1, 120, 100);
    move(svg, 2, 180, 100);
    const last = states.at(-1)!;
    expect(last.zoom).toBeGreaterThan(1);
    // Zooming toward the right of centre pans the frame that way too.
    expect(last.pan.x).toBeGreaterThan(0);
  });

  test("a released pinch drops back to a single pointer without jumping", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 80, 100);
    down(svg, 2, 120, 100);
    move(svg, 1, 60, 100);
    move(svg, 2, 140, 100);
    const zoomed = states.at(-1)!.zoom;
    up(svg, 2, 140, 100);
    // One pointer left down does not resume as a drag mid-gesture and does
    // not reset the zoom the pinch just set.
    move(svg, 1, 40, 100);
    expect(states.at(-1)!.zoom).toBe(zoomed);
  });
});

describe("wheel", () => {
  test("scrolling the wheel zooms in around the cursor", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    act(() => {
      const evt = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
        clientX: 100,
        clientY: 100,
      });
      const prevented = !svg.dispatchEvent(evt);
      expect(prevented).toBe(true);
    });
    expect(states.at(-1)!.zoom).toBeGreaterThan(1);
  });

  test("ctrlKey (trackpad pinch) zooms too, and further for the same delta", () => {
    const plain: Reported[] = [];
    const svgPlain = render({ onState: (s) => plain.push(s) });
    act(() => {
      svgPlain.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -50, clientX: 100, clientY: 100 }),
      );
    });

    const ctrl: Reported[] = [];
    const svgCtrl = render({ onState: (s) => ctrl.push(s) });
    act(() => {
      svgCtrl.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -50,
          clientX: 100,
          clientY: 100,
          ctrlKey: true,
        }),
      );
    });

    expect(ctrl.at(-1)!.zoom).toBeGreaterThan(plain.at(-1)!.zoom);
  });

  test("zooming out never crosses the minimum", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    act(() => {
      svg.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 500, clientX: 100, clientY: 100 }),
      );
    });
    expect(states.at(-1)!.zoom).toBe(1);
  });
});

describe("double-tap and double-click", () => {
  test("two quick taps at the same spot zoom in", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 100, 100);
    up(svg, 1, 100, 100);
    down(svg, 1, 101, 101);
    up(svg, 1, 101, 101);
    expect(states.at(-1)!.zoom).toBeGreaterThan(1);
  });

  test("a mouse double-click does the same", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 100, 100, "mouse");
    up(svg, 1, 100, 100, "mouse");
    down(svg, 1, 100, 100, "mouse");
    up(svg, 1, 100, 100, "mouse");
    expect(states.at(-1)!.zoom).toBeGreaterThan(1);
  });

  test("a single tap does not zoom", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 100, 100);
    up(svg, 1, 100, 100);
    expect(states.at(-1)!.zoom).toBe(1);
  });

  test("tapping a marker never zooms — the marker's own click owns the tap", () => {
    const states: Reported[] = [];
    render({ onState: (s) => states.push(s) });
    const marker = container!.querySelector('[data-testid="marker"]')!;
    down(marker, 1, 100, 100);
    up(marker, 1, 100, 100);
    down(marker, 1, 100, 100);
    up(marker, 1, 100, 100);
    expect(states.at(-1)!.zoom).toBe(1);
  });

  test("a drag does not count as a tap, however it ends", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 100, 100, "mouse");
    move(svg, 1, 130, 100, "mouse");
    up(svg, 1, 130, 100, "mouse");
    down(svg, 1, 130, 100, "mouse");
    up(svg, 1, 130, 100, "mouse");
    // The drag panned the map; the second, stationary click is this
    // gesture's first real tap and must not read as a "double" with the
    // drag's release.
    expect(states.at(-1)!.zoom).toBe(1);
  });
});

describe("keyboard, once the map has focus", () => {
  test("+ zooms in and - zooms back out", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+", cancelable: true }));
    });
    const zoomedIn = states.at(-1)!.zoom;
    expect(zoomedIn).toBeGreaterThan(1);
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "-", cancelable: true }));
    });
    expect(states.at(-1)!.zoom).toBeLessThan(zoomedIn);
  });

  test("the arrows pan, each in its own direction", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", cancelable: true }));
    });
    expect(states.at(-1)!.pan.x).toBeGreaterThan(0);
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", cancelable: true }));
    });
    expect(states.at(-1)!.pan.y).toBeGreaterThan(0);
  });

  test("0 fits the whole trip again — back to zoom 1 and no pan", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+", cancelable: true }));
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", cancelable: true }));
    });
    expect(states.at(-1)!.zoom).not.toBe(1);
    act(() => {
      svg.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "0", cancelable: true }));
    });
    expect(states.at(-1)!).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });
});

describe("cooperative mode — the embedded trip-page map", () => {
  test("touch-action lets the page scroll under one finger", () => {
    const svg = render({ cooperative: true });
    expect(svg.style.touchAction).toBe("pan-y");
  });

  test("a non-cooperative map claims every finger", () => {
    const svg = render({ cooperative: false });
    expect(svg.style.touchAction).toBe("none");
  });

  test("one touch does not pan the map — the page is left to scroll", () => {
    const states: Reported[] = [];
    const svg = render({ cooperative: true, onState: (s) => states.push(s) });
    down(svg, 1, 100, 100);
    move(svg, 1, 100, 160);
    expect(states.at(-1)!.pan).toEqual({ x: 0, y: 0 });
  });

  test("two touches still pinch, even though one alone does not pan", () => {
    const states: Reported[] = [];
    const svg = render({ cooperative: true, onState: (s) => states.push(s) });
    down(svg, 1, 80, 100);
    down(svg, 2, 120, 100);
    move(svg, 1, 60, 100);
    move(svg, 2, 140, 100);
    expect(states.at(-1)!.zoom).toBeGreaterThan(1);
  });

  test("a single tap asks to go full screen instead of doing anything to the map", () => {
    const onRequestFullscreen = vi.fn();
    const svg = render({ cooperative: true, onRequestFullscreen });
    down(svg, 1, 100, 100);
    up(svg, 1, 100, 100);
    expect(onRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  test("a mouse drag still pans — cooperative mode is only about touch", () => {
    const states: Reported[] = [];
    const svg = render({ cooperative: true, onState: (s) => states.push(s) });
    down(svg, 1, 100, 100, "mouse");
    move(svg, 1, 130, 100, "mouse");
    expect(states.at(-1)!.pan.x).not.toBe(0);
  });

  test("tapping a marker in cooperative mode selects it, not full screen", () => {
    const onRequestFullscreen = vi.fn();
    render({ cooperative: true, onRequestFullscreen });
    const marker = container!.querySelector('[data-testid="marker"]')!;
    down(marker, 1, 100, 100);
    up(marker, 1, 100, 100);
    expect(onRequestFullscreen).not.toHaveBeenCalled();
  });
});

describe("a plain one-pointer drag", () => {
  test("pans the map, mouse or touch, off the cooperative map", () => {
    const states: Reported[] = [];
    const svg = render({ onState: (s) => states.push(s) });
    down(svg, 1, 100, 100);
    move(svg, 1, 140, 100);
    expect(states.at(-1)!.pan.x).not.toBe(0);
  });
});

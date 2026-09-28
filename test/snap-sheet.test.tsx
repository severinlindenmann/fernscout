// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { nearestSnapIndex, useSnapDrag } from "@/components/SnapSheet";

/**
 * The drag-and-snap decision `MobileDaySheet` (B2327) and the map page's
 * `MobileMapSheet` (B2427) now share — see the doc comment on
 * `nearestSnapIndex` in components/SnapSheet.tsx.
 */

describe("nearestSnapIndex", () => {
  test("settles on the snap it ended up closest to, by default", () => {
    const heights = [0, 100, 200];
    expect(nearestSnapIndex(heights, 40, 0, 1)).toBe(0);
    expect(nearestSnapIndex(heights, 60, 0, 1)).toBe(1);
    expect(nearestSnapIndex(heights, 160, 0, 1)).toBe(2);
  });

  test("a fast fling always moves exactly one snap in the direction thrown", () => {
    const heights = [0, 100, 200];
    // Positive velocity (finger moving down) — even though 90 is nearest to
    // the middle snap, a fast-enough downward fling drops to the one below.
    expect(nearestSnapIndex(heights, 90, 600, 1)).toBe(0);
    // A fast upward fling from the middle goes up one instead.
    expect(nearestSnapIndex(heights, 110, -600, 1)).toBe(2);
    // Clamped at the ends — nowhere further to go.
    expect(nearestSnapIndex(heights, 195, -600, 2)).toBe(2);
  });

  test("a slow drag under the fling speed uses position, not direction", () => {
    const heights = [0, 100, 200];
    expect(nearestSnapIndex(heights, 90, 400, 1)).toBe(1);
  });

  test("custom per-boundary thresholds reproduce MobileDaySheet's own bar exactly", () => {
    // `MobileDaySheet`'s two points, `[0, fullHeight]`, close threshold at a
    // quarter of the panel — boundary at 0.75 * height, not the 0.5 a plain
    // nearest-of-two would use.
    const heights = [0, 300];
    // Dragged down by 25% exactly (height 225) — right at the bar, closes.
    expect(nearestSnapIndex(heights, 225, 0, 1, [0.75])).toBe(0);
    // Dragged down by less than 25% (height 240) stays open.
    expect(nearestSnapIndex(heights, 240, 0, 1, [0.75])).toBe(1);
    // At height 200 (dragged down by a third), a plain midpoint default
    // would call it "closer to open" (150 is the midpoint) and settle
    // there — but the 0.75 bar this sheet actually uses puts the boundary
    // at 225, so the same drag closes instead. The parameter is the whole
    // difference between the two sheets' behaviour.
    expect(nearestSnapIndex(heights, 200, 0, 1)).toBe(1);
    expect(nearestSnapIndex(heights, 200, 0, 1, [0.75])).toBe(0);
  });
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function Harness({ heights, onHeight }: { heights: number[]; onHeight: (h: number) => void }) {
  const [index, setIndex] = useState(0);
  // Reduced motion throughout — a settle is a duration-0 snap to the target
  // rather than a spring, so the assertions below don't need to wait on an
  // animation frame.
  const { height, bind } = useSnapDrag({ heights, index, onIndexChange: setIndex, reducedMotion: true });
  height.on("change", onHeight);
  return (
    <button type="button" data-testid="handle" {...bind}>
      handle
    </button>
  );
}

function render(heights: number[], onHeight: (h: number) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness heights={heights} onHeight={onHeight} />);
  });
  const handle = container.querySelector<HTMLButtonElement>('[data-testid="handle"]')!;
  (handle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  return handle;
}

function drag(el: Element, id: number, points: Array<[number, number]>) {
  act(() => {
    const [x0, y0] = points[0];
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: id, clientX: x0, clientY: y0 }));
  });
  for (const [x, y] of points.slice(1)) {
    act(() => {
      el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: id, clientX: x, clientY: y }));
    });
  }
}

async function release(el: Element, id: number, x: number, y: number) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: id, clientX: x, clientY: y }));
    // Flushes the (reduced-motion, duration-0) settle animation's own
    // requestAnimationFrame tick — jsdom's rAF is a ~16ms setTimeout.
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe("useSnapDrag", () => {
  test("dragging the handle up grows the panel toward the taller snap", async () => {
    let last = 0;
    const handle = render([0, 200], (h) => (last = h));
    drag(handle, 1, [
      [0, 0],
      [0, -50],
    ]);
    expect(last).toBeGreaterThan(0);
    await release(handle, 1, 0, -50);
    // Settles onto a real snap point, not left at wherever the finger let go.
    expect([0, 200]).toContain(Math.round(last));
  });
});

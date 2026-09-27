// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import TimeScrubber, { type ScrubberStop } from "@/components/map/TimeScrubber";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2428 — the time scrubber's own claims: x-position is proportional to
 * *dates*, not to stop order; a live trip's right edge is today; the handle
 * moves with the keyboard and names itself with `aria-valuetext`; day chips
 * only appear at 7 stops or fewer.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(
  stops: ScrubberStop[],
  props: { selectedIndex?: number; onSelect?: (i: number) => void; live?: boolean } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TimeScrubber
          stops={stops}
          selectedIndex={props.selectedIndex ?? 0}
          onSelect={props.onSelect ?? (() => {})}
          live={props.live}
        />
      </LocaleProvider>,
    );
  });
  return container!;
}

function slider(): HTMLElement {
  return container!.querySelector('[role="slider"]')!;
}

function tickLefts(): number[] {
  // The track's own tick marks, distinguished from the handle by lacking
  // role="slider" — the same "aria-pressed" separation trick trip-map.test
  // uses for its own view controls.
  return Array.from(container!.querySelectorAll<HTMLElement>('div[style*="left"]'))
    .filter((el) => el.getAttribute("role") !== "slider")
    .map((el) => parseFloat(el.style.left));
}

// Five months apart, like `asia-2023` — the whole point of "proportional",
// where stop order alone would space these evenly.
const fiveMonths: ScrubberStop[] = [
  { key: "a", date: "2023-01-01", location: "Bangkok" },
  { key: "b", date: "2023-02-01", location: "Hanoi" },
  { key: "c", date: "2023-06-01", location: "Bali" },
];

describe("proportional to dates", () => {
  test("ticks are spaced by elapsed time, not evenly by stop order", () => {
    render(fiveMonths);
    const lefts = tickLefts();
    expect(lefts[0]).toBeCloseTo(0, 3);
    expect(lefts[2]).toBeCloseTo(100, 3);
    // Jan 1 -> Feb 1 is 31 days of a 151-day span; Feb 1 -> Jun 1 is 120.
    // Evenly by order these would be 0/50/100 — they are not.
    expect(lefts[1]).not.toBeCloseTo(50, 0);
    expect(lefts[1]).toBeCloseTo((31 / 151) * 100, 1);
  });

  test("a live trip's axis reaches today, not the last written stop", () => {
    const today = new Date().toISOString().slice(0, 10);
    const stops: ScrubberStop[] = [
      { key: "a", date: "2020-01-01", location: "Start" },
      { key: "b", date: "2020-01-02", location: "Yesterday-ish" },
    ];
    render(stops, { live: true, selectedIndex: 1 });
    // With a real "today" far past 2020, the last written stop sits well
    // short of the right edge rather than pinned to it.
    const lefts = tickLefts();
    expect(lefts[1]).toBeLessThan(1);
    void today;
  });
});

describe("keyboard", () => {
  test("arrow keys move to the previous/next stop, Home/End to first/last", () => {
    const onSelect = vi.fn();
    render(fiveMonths, { selectedIndex: 1, onSelect });
    const el = slider();
    act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(0);
    act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });
});

describe("accessibility", () => {
  test("names the selected stop and its date via aria-valuetext", () => {
    render(fiveMonths, { selectedIndex: 1 });
    expect(slider().getAttribute("aria-valuetext")).toContain("Hanoi");
    expect(slider().getAttribute("aria-valuenow")).toBe("1");
    expect(slider().getAttribute("aria-valuemax")).toBe(String(fiveMonths.length - 1));
  });
});

describe("day chips", () => {
  const chipsShown = () =>
    Array.from(container!.querySelectorAll("button")).some((b) => b.getAttribute("aria-pressed") !== null);
  const days = (dates: string[]): ScrubberStop[] => dates.map((date, i) => ({ key: String(i), date, location: `Stop ${i}` }));

  test("shown when the trip spans 7 days or fewer", () => {
    render(days(["2024-09-12", "2024-09-13", "2024-09-14", "2024-09-15"]));
    expect(chipsShown()).toBe(true);
  });

  test("hidden when the trip spans more than 7 days, even with only a few stops", () => {
    render(days(["2026-06-01", "2026-06-19", "2026-08-24"]));
    expect(chipsShown()).toBe(false);
  });

  test("hidden for eight consecutive days", () => {
    render(days(Array.from({ length: 8 }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`)));
    expect(chipsShown()).toBe(false);
  });

  test("hidden for a five-month trip", () => {
    render(fiveMonths);
    expect(chipsShown()).toBe(false);
  });
});

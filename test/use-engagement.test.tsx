// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * "Has this reader actually read anything?" — the rule `PushPrompt` and the
 * showcase bar share, driven on a fake clock.
 *
 * The rule itself is unchanged from when it was counted by a one-second
 * interval: fifteen seconds with the tab in front, plus a screen's scroll or a
 * page change inside the journal. What these pin is that it still holds now
 * that it is one timeout armed for the dwell still owed, and that a page
 * where the reader has done nothing has no clock running at all.
 */

let pathname = "/alex/trips/asia";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { useEngagement } = await import("@/components/useEngagement");

let root: Root;
let container: HTMLDivElement;
let visibility: DocumentVisibilityState = "visible";

function Probe() {
  return <p>{useEngagement() ? "engaged" : "not yet"}</p>;
}

/** What the hook answered on the last render. */
function isEngaged() {
  return container.textContent === "engaged";
}

function render() {
  act(() => root.render(<Probe />));
}

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

function setVisibility(state: DocumentVisibilityState) {
  act(() => {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
  visibility = "visible";
  pathname = "/alex/trips/asia";
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useEngagement", () => {
  test("dwell alone is not enough, and runs no clock while waiting", () => {
    render();
    expect(vi.getTimerCount()).toBe(0);
    wait(60_000);
    expect(isEngaged()).toBe(false);
  });

  test("a screen's scroll plus fifteen visible seconds is", () => {
    render();
    wait(5_000);
    scrollTo(400);
    // Time already spent looking counts; only what is still owed is waited.
    expect(vi.getTimerCount()).toBe(1);
    wait(9_900);
    expect(isEngaged()).toBe(false);
    wait(100);
    expect(isEngaged()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a short scroll is not acting", () => {
    render();
    scrollTo(100);
    wait(30_000);
    expect(isEngaged()).toBe(false);
  });

  test("time with the tab in the background does not count", () => {
    render();
    scrollTo(400);
    wait(10_000);
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    wait(120_000);
    expect(isEngaged()).toBe(false);
    setVisibility("visible");
    wait(4_900);
    expect(isEngaged()).toBe(false);
    wait(100);
    expect(isEngaged()).toBe(true);
  });

  test("moving to another page inside the journal counts as acting", () => {
    render();
    wait(3_000);
    pathname = "/alex/trips/asia/day/one";
    render();
    wait(14_900);
    expect(isEngaged()).toBe(false);
    wait(100);
    expect(isEngaged()).toBe(true);
  });
});

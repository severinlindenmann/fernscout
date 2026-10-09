// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import CutProse from "@/components/CutProse";

/**
 * B-2938 — a day of nine to twelve lines was cut at the cap with no fade and
 * no button, so its last lines could not be read. Text is now shown whole up
 * to 1.5 times the cap, and cut, with the button, only past that.
 */

vi.mock("@/components/LocaleProvider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

/** jsdom has no layout, so the text's own height is stated, in px (16px = 1rem). */
function mount(heightPx: number): HTMLElement {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(heightPx);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<CutProse>text</CutProse>));
  return container.firstElementChild!.firstElementChild as HTMLElement;
}

describe("CutProse", () => {
  test("short text is whole, with no button", () => {
    const box = mount(80);
    expect(box.className).not.toContain("overflow-hidden");
    expect(container!.querySelector("button")).toBeNull();
  });

  test("text between the cap and 1.5 times it is whole, with no button", () => {
    const box = mount(280);
    expect(box.className).not.toContain("overflow-hidden");
    expect(container!.querySelector("button")).toBeNull();
  });

  test("longer text is cut, with the button, and the button shows the rest", () => {
    const box = mount(500);
    expect(box.className).toContain("overflow-hidden");
    const button = container!.querySelector("button")!;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(box.className).not.toContain("overflow-hidden");
    expect(container!.querySelector("button")).toBeNull();
  });
});

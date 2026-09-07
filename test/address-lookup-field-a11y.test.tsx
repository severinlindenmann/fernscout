// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AddressLookupField from "@/components/AddressLookupField";
import type { AddressSuggestion } from "@/lib/addressLookupTypes";

/**
 * B419 — the highlight the arrow keys move through the suggestion list was
 * carried only by `aria-selected` and a visual style, so focus never left
 * the text input and nothing told a screen reader which option the keys had
 * landed on. `CountryField` and `TelField` already set
 * `aria-activedescendant`; this pins the same fix on `AddressLookupField`,
 * the one of the three still missing it.
 *
 * B391 landed jsdom for this suite, which is what makes this provable by a
 * unit test rather than only by a browser session with a screen reader, as
 * the ticket originally expected.
 */

const SUGGESTIONS: AddressSuggestion[] = [
  { line1: "Bahnhofstrasse 1", postcode: "8001", city: "Zürich", country: "CH" },
  { line1: "Bahnhofstrasse 2", postcode: "8001", city: "Zürich", country: "CH" },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ results: SUGGESTIONS }))),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

function input(): HTMLInputElement {
  return container!.querySelector("input")!;
}

async function typeQuery(): Promise<void> {
  const el = input();
  await act(async () => {
    // `focus()` fires both `focus` and the bubbling `focusin` jsdom needs
    // for React's delegated `onFocus` to see it — a plain dispatched
    // `FocusEvent("focus", …)` does not bubble and never reaches it.
    el.focus();
    // The field debounces 300ms before it asks the (stubbed) provider; the
    // effect that fires it already runs off the `value` prop set at mount.
    await new Promise((r) => setTimeout(r, 350));
  });
}

function arrowDown(): void {
  act(() => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
}

describe("AddressLookupField — aria-activedescendant follows the highlight", () => {
  test("nothing is highlighted before the arrow keys are used", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddressLookupField
          id="addr"
          value="Bahnhofstrasse"
          onChange={() => {}}
          onPick={() => {}}
          enabled
          username="alex"
          locale="en"
          label="Street and number"
          attribution="© OpenStreetMap contributors"
          unavailable="unavailable"
          className=""
        />,
      );
    });
    await typeQuery();

    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    // Highlight starts at the first suggestion (index 0), same as the
    // component's own `useState(0)` — activedescendant should already name it.
    expect(input().getAttribute("aria-activedescendant")).toBe(options[0].id);
  });

  test("arrowing down moves aria-activedescendant to the next option's id", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddressLookupField
          id="addr"
          value="Bahnhofstrasse"
          onChange={() => {}}
          onPick={() => {}}
          enabled
          username="alex"
          locale="en"
          label="Street and number"
          attribution="© OpenStreetMap contributors"
          unavailable="unavailable"
          className=""
        />,
      );
    });
    await typeQuery();

    const options = container.querySelectorAll('[role="option"]');
    arrowDown();
    expect(input().getAttribute("aria-activedescendant")).toBe(options[1].id);
  });

  test("disabled (no capability) renders no combobox and no activedescendant", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AddressLookupField
          id="addr"
          value=""
          onChange={() => {}}
          onPick={() => {}}
          enabled={false}
          username="alex"
          locale="en"
          label="Street and number"
          attribution=""
          unavailable=""
          className=""
        />,
      );
    });
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    expect(input().hasAttribute("role")).toBe(false);
  });
});

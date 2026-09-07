// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import TelField from "@/components/TelField";

/**
 * B391 — `TelField`'s country combobox (searchable text box, arrow keys,
 * Enter, Escape, click-outside-to-close, since B390) had no DOM-level test:
 * `test/tel-field.test.ts` only covers the pure functions pulled out of the
 * component. This reuses the jsdom + `createRoot` harness B507 added and
 * B419's `test/address-lookup-field-a11y.test.tsx` uses again, rather than
 * adding `@testing-library/react` for one component.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function ccInput(): HTMLInputElement {
  return container!.querySelector("#test-cc") as HTMLInputElement;
}

function options(): HTMLElement[] {
  return Array.from(container!.querySelectorAll('[role="option"]'));
}

function render(onChange: (cc: string, national: string) => void, cc = "", national = "") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <TelField
        id="test"
        cc={cc}
        national={national}
        onChange={onChange}
        labelCountry="Country code"
        searchPlaceholder="Search"
        noMatches="No matches"
        locale="en"
      />,
    );
  });
}

function type(value: string): void {
  const el = ccInput();
  act(() => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function keydown(key: string): void {
  act(() => {
    ccInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("TelField's country combobox", () => {
  test("focusing opens the list, unfiltered", () => {
    render(() => {});
    act(() => ccInput().focus());
    expect(options().length).toBeGreaterThan(1);
  });

  test("typing filters the listbox to matching countries", () => {
    render(() => {});
    act(() => ccInput().focus());
    type("Switzerland");
    const opts = options();
    expect(opts.length).toBe(1);
    expect(opts[0].textContent).toContain("Switzerland");
    expect(opts[0].textContent).toContain("+41");
  });

  test("Enter on the highlighted option picks it and closes the list", () => {
    let picked: [string, string] | undefined;
    render((cc, national) => {
      picked = [cc, national];
    }, "", "76 561 31 50");
    act(() => ccInput().focus());
    type("Switzerland");
    keydown("Enter");
    expect(picked).toEqual(["41", "76 561 31 50"]);
    expect(options().length).toBe(0);
  });

  test("ArrowDown moves the highlight before Enter picks it", () => {
    let picked: [string, string] | undefined;
    render((cc, national) => {
      picked = [cc, national];
    });
    act(() => ccInput().focus());
    type("41");
    const before = options().map((o) => o.textContent);
    expect(before.length).toBeGreaterThan(1);
    keydown("ArrowDown");
    keydown("Enter");
    // Whatever the second row of the "+41"-matching list was, not the first.
    const secondCc = before[1]?.match(/\+(\d+)/)?.[1];
    expect(picked?.[0]).toBe(secondCc);
  });

  test("Escape closes the list without picking anything", () => {
    let called = false;
    render(() => {
      called = true;
    });
    act(() => ccInput().focus());
    type("Switzerland");
    keydown("Escape");
    expect(options().length).toBe(0);
    expect(called).toBe(false);
  });

  test("clicking an option picks it", () => {
    let picked: [string, string] | undefined;
    render((cc, national) => {
      picked = [cc, national];
    }, "", "76 561 31 50");
    act(() => ccInput().focus());
    type("Switzerland");
    const option = options()[0];
    act(() => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(picked).toEqual(["41", "76 561 31 50"]);
  });

  test("clicking outside the field closes the list", () => {
    render(() => {});
    act(() => ccInput().focus());
    type("Switzerland");
    expect(options().length).toBe(1);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(options().length).toBe(0);
  });
});

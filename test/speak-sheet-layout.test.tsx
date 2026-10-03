// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import SpeakSheet from "@/components/SpeakSheet";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2784 — the Speak sheet is only as tall as its content on a phone, and a
 * popover beside the pill that opened it on a wide screen.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function render(wide: boolean, anchor?: { top: number; bottom: number; left: number }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const noop = () => {};
  act(() =>
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SpeakSheet
          phase="listening"
          anchor={anchor}
          seconds={3}
          level={0}
          languageLabel="English"
          error=""
          nearLimit={false}
          confirmDiscard={false}
          leaving={false}
          onToggle={noop}
          onDiscard={noop}
          onFinish={noop}
          onConfirmDiscard={noop}
          onCancelDiscard={noop}
        />
      </LocaleProvider>,
    ),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  return dialog.children[1] as HTMLElement;
}

describe("Speak sheet layout", () => {
  test("a phone gets a bottom sheet sized by its content, not pinned to the top", () => {
    const panel = render(false, { top: 500, bottom: 544, left: 20 });
    expect(panel.className).toContain("bottom-0");
    expect(panel.className).not.toMatch(/\btop-11\b/);
    expect(panel.style.top).toBe("");
  });

  test("a wide screen gets a popover placed at the pill that opened it", () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 900);
    const panel = render(true, { top: 300, bottom: 344, left: 400 });
    expect(panel.className).toContain("fs-speak-pop");
    expect(panel.style.left).toBe("400px");
    expect(panel.style.top).toBe("352px");
    expect(panel.style.width).toBe("380px");
  });

  test("near the bottom of a wide screen the popover opens above the pill", () => {
    vi.stubGlobal("innerWidth", 1280);
    vi.stubGlobal("innerHeight", 900);
    const panel = render(true, { top: 700, bottom: 744, left: 1100 });
    expect(panel.style.bottom).toBe("208px");
    expect(panel.style.left).toBe(`${1280 - 380 - 16}px`);
  });
});

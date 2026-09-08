// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import RecordButton from "@/components/RecordButton";
import { dictionaryFor } from "@/lib/locales";

/**
 * B813 — a denied microphone is a problem, not a status update.
 *
 * `getUserMedia` rejecting is the one thing this control can never recover
 * from itself — the browser, not the page, holds that permission — so the
 * copy has to be seen *and* heard. `role="alert"` is assertive and interrupts
 * a screen reader; `role="status"` is polite and can be missed entirely,
 * which is what every other error line in this codebase avoids (B796).
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", class {});
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: () => Promise.reject(new Error("Permission denied")),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

test("a denied microphone is announced as a problem, and leaves a way forward", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <RecordButton username="alex" consented provider="dry-run" onText={() => {}} />
      </LocaleProvider>,
    );
  });
  const button = container.querySelector("button") as HTMLButtonElement;
  await act(async () => {
    button.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
  });

  const alert = container.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert!.textContent).toMatch(/microphone/i);
  // Honest about where the fix lives — the browser's own settings, not a
  // control this page can press on somebody's behalf — and leaves typing as
  // the way forward.
  expect(alert!.textContent).toMatch(/settings/i);
  expect(alert!.textContent).toMatch(/type/i);
  // The permanent sr-only status region (start/stop) never carries the
  // refusal — a polite region is exactly the failure mode this fixes.
  const status = container.querySelector('[role="status"]');
  expect(status?.textContent ?? "").not.toMatch(/microphone/i);
});

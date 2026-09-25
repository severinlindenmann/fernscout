// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import RecordButton from "@/components/RecordButton";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2228 — under `next dev`, React Strict Mode's mount → cleanup → remount
 * left `unmounted.current` `true` for the component's whole life: the
 * cleanup that runs `pagehide`/`visibilitychange` teardown sets it, and
 * nothing ever set it back. `start()`'s own guard — added so a route away
 * during the `getUserMedia` wait never opens the microphone once it resolves
 * — then read it as "already gone" on every press, silently: no error, no
 * recording, no request. Production never replays effects, so this was
 * invisible outside local development.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let stopped: () => void;
let transcribeCalls: number;

class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x".repeat(64)]) });
    this.onstop?.();
    stopped();
  }
}

beforeEach(() => {
  stopped = () => {};
  transcribeCalls = 0;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ getTracks: () => [] } as unknown as MediaStream), 0),
        ),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      transcribeCalls += 1;
      return { ok: true, json: async () => ({ ok: true, text: "over the pass" }) };
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Let `getUserMedia` settle.
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("RecordButton under Strict Mode's double-invoked effects", () => {
  test("a press after the replayed mount still starts recording", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <StrictMode>
          <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
            <RecordButton username="alex" consented provider="dry-run" compact onText={() => {}} />
          </LocaleProvider>
        </StrictMode>,
      );
    });
    const button = container!.querySelector("button") as HTMLButtonElement;
    await click(button);
    // Recording under way: the stopwatch shows, not the pre-fix silence
    // where `start()` returned at its unmounted guard and nothing changed.
    expect(container!.textContent).toContain("0s");

    // And it transcribes: stop, and the dry-run request actually went out.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await click(button);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(transcribeCalls).toBe(1);
  });
});

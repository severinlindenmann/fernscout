// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import RecordButton from "@/components/RecordButton";
import { dictionaryFor } from "@/lib/locales";

/**
 * A click on the microphone — B995.
 *
 * Reported as "it does nothing": the microphone on the search box listened,
 * counted the seconds up, and never produced a word. Both halves of the press
 * were wrong and each hid the other.
 *
 * A mouse click is about forty milliseconds. `start()` awaits
 * `getUserMedia`, which is slower than that even when the permission has
 * already been given — so `pointerup` called `stop()` while `recorder.current`
 * was still null, `stop()` found nothing to stop, and the recording began a
 * moment later with nothing left to end it. And every press was treated as a
 * hold, so a click had no way to end one either.
 *
 * What is asserted here is the behaviour, not the mechanism: a click starts it
 * and it stays on; the next click ends it and the words come back.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let stopped: () => void;

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
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", {
    ...navigator,
    // Deliberately not resolved on the same tick: the whole bug is that the
    // release arrives before the microphone is granted.
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ getTracks: () => [] } as unknown as MediaStream), 0),
        ),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, text: "over the pass" }) })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

function render(
  onText: (said: string) => void,
  props: Partial<React.ComponentProps<typeof RecordButton>> = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <RecordButton
          username="alex"
          consented
          provider="dry-run"
          compact
          onText={onText}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return container!.querySelector("button") as HTMLButtonElement;
}

/** A mouse click, in the order a browser delivers it. */
async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Let `getUserMedia` settle — it resolves after the release, which is the
    // race this is about.
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("pressing the microphone", () => {
  test("a click starts it, and it is still listening afterwards", async () => {
    const button = render(() => {});
    await click(button);
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");
  });

  // The likeliest shape of the report: you click the microphone, then move the
  // mouse away to talk. Every press used to be a hold, so the pointer leaving
  // ended the recording a fraction of a second in — under the half-second
  // below which a recording is dropped as a slip. Listening stopped, nothing
  // was sent, and nothing was said about it.
  test("moving the pointer away after a click does not end it", async () => {
    const button = render(() => {});
    await click(button);
    await act(async () => {
      // React synthesises `onPointerLeave` from `pointerout`, so that is what
      // a test has to dispatch — a raw `pointerleave` reaches no handler.
      button.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");
  });

  test("the next click stops it, and what was said comes back", async () => {
    const said: string[] = [];
    const button = render((text) => said.push(text));
    await click(button);
    // Longer than the half-second below which a recording is treated as a slip
    // of the finger and never sent.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    await click(button);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container!.textContent).not.toContain("Listening");
    expect(said).toEqual(["over the pass"]);
  });

  /**
   * B1004 — the other half of "sometimes the microphone works".
   *
   * B995 fixed the *click*: a short press toggles, and the pointer leaving
   * afterwards stops nothing. A press held past `HOLD_MS` is still a hold, and
   * on the wizard's full-width bar that is correct. In a search field it is
   * not: the target is 44px in the corner of a text box, nobody keeps a
   * pointer on it while they speak, and the recording ended before the first
   * word. `hold={false}` is the search page's answer.
   */
  test("with hold off, a long press then a pointer leaving does not end it", async () => {
    const button = render(() => {}, { hold: false });
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      // Longer than HOLD_MS — a perfectly ordinary press.
      await new Promise((r) => setTimeout(r, 500));
      button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 5));
    });
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");

    await act(async () => {
      button.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
      await new Promise((r) => setTimeout(r, 5));
    });
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");
  });

  test("with hold on, a long press still ends on release — the wizard is unchanged", async () => {
    const button = render(() => {});
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container!.textContent).not.toContain("Listening");
  });

  /**
   * B1004 — the elapsed line is a sibling of the button, and that is what the
   * search page's markup is built around: only the button may sit inside the
   * field, because the field is what centres the magnifying glass. See
   * test/search-field-layout.test.tsx for the half this file cannot see.
   */
  test("the elapsed line is drawn beside the button, not inside it", async () => {
    const button = render(() => {});
    await click(button);
    expect(button.textContent).not.toContain("0s");
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");
  });

  /**
   * B1006 — the search box's own ceiling.
   *
   * `MAX_SPEECH_SECONDS` is fifteen minutes, which is a person dictating a
   * day. A search is a sentence, and a microphone left open in a search box
   * because somebody walked away is their credits going into silence.
   */
  test("stops itself at the ceiling the host names", async () => {
    const said: string[] = [];
    const button = render((text) => said.push(text), { maxSeconds: 1 });
    await click(button);
    // B1352: the compact row shows the stopwatch, not a sentence.
    expect(container!.textContent).toContain("0s");
    await act(async () => {
      // Past the ceiling, and past the half-second below which a recording is
      // dropped as a slip — so it stops *and* sends.
      await new Promise((r) => setTimeout(r, 1400));
    });
    expect(container!.textContent).not.toContain("Listening");
    expect(said).toEqual(["over the pass"]);
  });
});

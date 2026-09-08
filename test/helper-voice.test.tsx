// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * Speaking a turn — B893, round 7 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * The recorder itself is B686's and is not rebuilt or retested here: it is
 * stood in for by a button that hands over a transcript, which is exactly the
 * contract `RecordButton` has with whoever mounts it (`onText`). What is
 * asserted is the half this ticket is about — **the words are the person's**:
 * a transcript lands in the field where it can be corrected before it is
 * sent, it is added to what is already there rather than replacing it, and a
 * screen reader is told what was heard once, in a live region, rather than
 * being left to discover a value that changed under it.
 */

vi.mock("@/components/RecordButton", () => ({
  default: ({ onText }: { onText: (said: string) => void }) => (
    <button type="button" onClick={() => onText("we walked over the pass")}>
      mic
    </button>
  ),
}));

const HelperAsk = (await import("@/components/HelperAsk")).default;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dictionary = dictionaryFor("en");

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <HelperAsk username="alex" consented speech consentedSpeech speechProvider="dry-run" inRoom />
      </LocaleProvider>,
    );
  });
}

function field(): HTMLInputElement {
  return container!.querySelector("#ask-alex") as HTMLInputElement;
}

function speak() {
  const mic = Array.from(container!.querySelectorAll("button")).find(
    (one) => one.textContent === "mic",
  ) as HTMLButtonElement;
  act(() => mic.click());
}

function type(value: string) {
  const el = field();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a turn can be spoken", () => {
  test("the transcript lands in the field, editable before it is sent", () => {
    render();
    speak();
    expect(field().value).toBe("we walked over the pass");
    // Nothing has been sent: the microphone fills the box, and Ask sends it.
    expect(field().disabled).toBe(false);
    expect(document.activeElement).toBe(field());
  });

  test("it is added to what is already there, not put over it", () => {
    render();
    type("tuesday:");
    speak();
    expect(field().value).toBe("tuesday: we walked over the pass");
  });

  test("what was heard is announced, and says where to correct it", () => {
    render();
    speak();
    const said = Array.from(container!.querySelectorAll('[role="status"]')).find((one) =>
      (one.textContent ?? "").includes("we walked over the pass"),
    );
    expect(said).toBeTruthy();
    expect(said!.textContent).toContain("Correct it in the box");
  });

  test("the microphone is in the field's own box, before the send button", () => {
    render();
    const mic = Array.from(container!.querySelectorAll("button")).find(
      (one) => one.textContent === "mic",
    )!;
    expect(field().parentElement!.contains(mic)).toBe(true);
  });
});

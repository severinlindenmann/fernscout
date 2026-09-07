// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import RecordButton from "@/components/RecordButton";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B744 — the speech consent panel names the provider actually configured,
 * not "Deepgram" unconditionally.
 *
 * `RecordButton` starts with `consenting: false`; the text under test only
 * appears once the button is tapped with no prior consent. This reuses the
 * jsdom + `createRoot` harness `test/tel-field-combobox.test.tsx` established
 * rather than adding a testing-library dependency for one component.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(provider: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <RecordButton username="alex" consented={false} provider={provider} onText={() => {}} />
      </LocaleProvider>,
    );
  });
  const button = container.querySelector("button") as HTMLButtonElement;
  act(() => {
    button.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
  });
  return container.textContent ?? "";
}

describe("B744 — RecordButton names the real provider", () => {
  test("does not hard-code Deepgram for an instance running a different backend", () => {
    const text = render("dry-run");
    expect(text).not.toMatch(/Deepgram/);
    expect(text).toMatch(/nothing leaves this server/i);
  });

  test("names the configured provider when it is real", () => {
    const text = render("Deepgram");
    expect(text).toMatch(/Deepgram/);
    expect(text).not.toMatch(/nothing leaves this server/i);
  });
});

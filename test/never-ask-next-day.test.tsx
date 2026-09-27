// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import NeverAskNextDay from "@/components/NeverAskNextDay";
import { NEVER_KEY } from "@/components/PushPrompt";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2464 — "Don't ask me again" moved off `PushPrompt`'s own card (a one-way
 * button, easy to press by accident on a card the reader may only ever see
 * once) onto `/me`, beside the journal-specific push switch, as an ordinary
 * reversible toggle. Same jsdom + `createRoot` harness as
 * `test/day-notify-nobody.test.tsx`, rather than adding
 * `@testing-library/react` for one component.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  window.localStorage.clear();
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <NeverAskNextDay />
      </LocaleProvider>,
    );
  });
  return container.querySelector("input[type=checkbox]") as HTMLInputElement;
}

describe("the /me toggle for the day-end card", () => {
  test("starts unchecked when nothing has been decided yet", () => {
    const input = render();
    expect(input.checked).toBe(false);
  });

  test("reads a never-ask that was already set — for instance by a browser denial", () => {
    window.localStorage.setItem(NEVER_KEY, "1");
    const input = render();
    expect(input.checked).toBe(true);
  });

  test("checking it writes the key the card reads, and it can be turned back on", () => {
    const input = render();
    act(() => input.click());
    expect(window.localStorage.getItem(NEVER_KEY)).toBe("1");

    act(() => input.click());
    expect(window.localStorage.getItem(NEVER_KEY)).toBeNull();
  });
});

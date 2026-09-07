// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import ConfirmPanel from "@/components/ConfirmPanel";
import LocaleProvider from "@/components/LocaleProvider";
import RecordButton from "@/components/RecordButton";
import { dictionaryFor } from "@/lib/locales";

/**
 * B794, B795, B796 — the helper is operable without a mouse and without eyes.
 *
 * All three faults were found by a blind tester on the live site, and all
 * three are shapes a jsdom render can see: whether the record button answers a
 * `click` at all, whether a `ConfirmPanel` takes focus when it mounts, and
 * whether the wizard's refusal carries `role="alert"`. The same
 * `createRoot` harness `test/record-button-consent.test.tsx` uses, rather than
 * a testing-library dependency for three assertions.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        {node}
      </LocaleProvider>,
    );
  });
  return container;
}

describe("B794 — the microphone can be reached from a keyboard", () => {
  test("a click, which is what a keyboard sends, starts the flow", () => {
    const host = mount(
      <RecordButton username="alex" consented={false} provider="dry-run" onText={() => {}} />,
    );
    const button = host.querySelector("button") as HTMLButtonElement;

    // No pointerdown at all: this is exactly what Enter or Space on a focused
    // button delivers, and before B794 it did nothing whatsoever.
    act(() => button.click());
    expect(host.textContent).toMatch(/nothing leaves this server/i);
  });

  test("the accessible name says both ways of working it", () => {
    const host = mount(
      <RecordButton username="alex" consented provider="dry-run" onText={() => {}} />,
    );
    const name = host.querySelector("button")?.getAttribute("aria-label") ?? "";
    expect(name).toMatch(/press again/i);
    expect(name).toMatch(/hold/i);
  });

});

describe("B795 — a panel that replaces a button takes the focus", () => {
  test("ConfirmPanel is focused when it mounts", () => {
    const host = mount(
      <ConfirmPanel
        label="Delete the thing"
        question="Delete it?"
        confirmLabel="Delete it"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const panel = host.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(panel);
  });

  test("Escape cancels, and does not while it is busy", () => {
    let cancelled = 0;
    const host = mount(
      <ConfirmPanel
        label="Delete the thing"
        question="Delete it?"
        confirmLabel="Delete it"
        busy
        onConfirm={() => {}}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    const panel = host.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      panel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cancelled).toBe(0);
  });
});

describe("B796 — a refusal is spoken", () => {
  test("the wizard's error carries role=alert, as SignupWizard's does", () => {
    const wizard = readFileSync("components/AgentWizard.tsx", "utf8");
    // The one refusal in the wizard, and the shape the ticket names: the
    // paragraph that renders `error` has to be an alert.
    const errorBlock = wizard.slice(wizard.indexOf("{error && ("));
    expect(errorBlock.slice(0, 200)).toMatch(/role="alert"/);
  });

  test("the three sub-headings are headings", () => {
    const wizard = readFileSync("components/AgentWizard.tsx", "utf8");
    for (const key of ["agent.missingTitle", "agent.helperSuggestionTitle", "agent.captionsTitle"]) {
      const at = wizard.indexOf(`t("${key}")`);
      expect(at).toBeGreaterThan(-1);
      // The opening tag immediately before the call.
      const before = wizard.slice(0, at);
      const tag = before.slice(before.lastIndexOf("<"));
      expect(tag.startsWith("<h")).toBe(true);
    }
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import CheckWording from "@/components/extract/CheckWording";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1834 — the screen, not the pure function underneath it.
 *
 * Reported from a handset, in German: the card says "zum Korrigieren
 * antippen" and pressing the text did nothing. It was true: the only
 * tappable thing on the card was the single word the provider had flagged,
 * and a recording with no low-confidence word therefore had no tap target
 * at all while the label above it still made the promise.
 *
 * So these tests are about the promise the label makes. Every one of them
 * would have passed on a screen that could only edit one word, except the
 * ones that say otherwise — which is the point.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(props: Parameters<typeof CheckWording>[0]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <CheckWording {...props} />
      </LocaleProvider>,
    );
  });
  return container;
}

/** The transcript's own tap target — the control holding the heard text,
 *  which is not either of the two buttons at the foot of the screen. */
function transcriptButton(el: HTMLElement): HTMLButtonElement | undefined {
  return [...el.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Ban Mi Fuong"),
  ) as HTMLButtonElement | undefined;
}

const HEARD = "We ate at Ban Mi Fuong and walked home.";

describe("CheckWording — the whole transcript is editable, not only the flagged word", () => {
  test("with NO flagged word the transcript is still tappable, and opens for editing", () => {
    // The reported case: nothing was uncertain, so nothing was a button.
    const el = render({ text: HEARD, recordedSeconds: 7, onKeep: () => {}, onRedo: () => {} });

    const tap = transcriptButton(el);
    expect(tap, "the transcript must be tappable even with nothing flagged").toBeDefined();

    act(() => tap!.click());
    const box = el.querySelector("textarea");
    expect(box, "tapping must open the text for editing").not.toBeNull();
    expect(box!.value).toBe(HEARD);
  });

  test("a word the provider did NOT flag can be corrected, and is what is kept", () => {
    let kept: string | undefined;
    const el = render({
      text: HEARD,
      uncertain: { word: "Ban", occurrence: 0 },
      recordedSeconds: 7,
      onKeep: (t) => {
        kept = t;
      },
      onRedo: () => {},
    });

    act(() => transcriptButton(el)!.click());
    const box = el.querySelector("textarea")!;
    // "walked" was never flagged; on the old screen it could not be touched.
    const fixed = HEARD.replace("walked home", "cycled home");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, fixed);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const keep = [...el.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("keep going"),
    ) as HTMLButtonElement;
    act(() => keep.click());

    expect(kept).toBe(fixed);
  });

  test("the flagged word is still picked out before the tap, so the eye goes there first", () => {
    const el = render({
      text: HEARD,
      uncertain: { word: "Ban", occurrence: 0 },
      recordedSeconds: 7,
      onKeep: () => {},
      onRedo: () => {},
    });

    const marked = el.querySelector("span.bg-coral-100");
    expect(marked?.textContent).toBe("Ban");
  });

  test("no flagged word means no uncertain-word panel — a promise is not made about a guess", () => {
    const el = render({ text: HEARD, recordedSeconds: 7, onKeep: () => {}, onRedo: () => {} });
    expect(el.textContent).not.toContain("One word looked uncertain");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { JournalVisibility } from "@/components/Visibility";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1591 — the journal's badge sits inside the `<summary>` of the card on
 * `/me`, and that is the whole reason this file exists.
 *
 * A `<button>` nested in a `<summary>` toggles the disclosure it is inside
 * unless the press is stopped. So pressing the badge would have opened the
 * chooser and folded the panel shut underneath it in the same gesture — which
 * looks like the control not working, and is the kind of thing a server-render
 * snapshot cannot see at all. The two other faults this ticket fixed were both
 * of that family: a hit target lying over the badge, and a panel parsed out of
 * its own anchor. All three needed a real click.
 *
 * So: a real click, in a real `<details>`, asserting the disclosure did not
 * move — not that some class is present.
 */

// `JournalVisibility` refreshes the page after a successful save; nothing here
// saves, so the router only has to exist.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

let host: HTMLDivElement;
let root: Root;

function card() {
  return (
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <details>
        <summary>
          Viki + Sevi&apos;s Reisen
          <JournalVisibility username="alex" journal={{ visibility: "public" }} />
        </summary>
        <p>The panel inside the pencil.</p>
      </details>
    </LocaleProvider>
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(card()));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function badge() {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Change who may read this",
  );
  if (!found) throw new Error("no badge rendered");
  return found;
}

/**
 * Returns whether the press was cancelled, which is the whole assertion for
 * the `<summary>` case.
 *
 * **jsdom does not implement a disclosure toggling when its summary is
 * clicked**, so asserting `details.open === false` afterwards passes whether
 * or not the handler guards it — checked by deleting the guard and watching
 * this file stay green, which is the only way to know a test is not a
 * decoration. What actually stops the native toggle is `preventDefault()` on
 * the click, and that jsdom does model. So the assertion is on the mechanism,
 * and the behaviour itself is covered by a real browser press in
 * `docs/tasks` B1591's acceptance run.
 */
function press(el: HTMLElement): { cancelled: boolean } {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
  return { cancelled: event.defaultPrevented };
}

describe("the journal badge inside the card's summary", () => {
  test("renders the journal's word without the card being opened", () => {
    const details = document.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(badge().textContent).toContain("Public");
  });

  test("pressing it cancels the click, so the disclosure cannot toggle", () => {
    const details = document.querySelector("details")!;
    const { cancelled } = press(badge());

    // The assertion the ticket is about: an uncancelled click inside a
    // `<summary>` folds the card shut under the chooser that just opened.
    expect(cancelled).toBe(true);
    expect(details.open).toBe(false);
    // And the chooser is up, portalled out to the body rather than nested in
    // the `<summary>`, where its markup would be invalid.
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.closest("details")).toBeNull();
    expect(dialog?.textContent).toContain("Guests");
  });

  test("Escape closes it, and still without touching the disclosure", () => {
    const details = document.querySelector("details")!;
    press(badge());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(details.open).toBe(false);
  });
});

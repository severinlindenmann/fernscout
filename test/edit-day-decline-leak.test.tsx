// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import EditDay from "@/components/EditDay";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B1899 — the same shape as `AddDayFlow`'s own leak, found while grepping
 * for it: `EditDay.tsx`'s E3✗ step renders `<DeclineScreen field="media"
 * .../>` at the same position for every entry index in `declineQueue`, also
 * with no `key`. Emptying the gallery on two updates in one save would
 * carry the first update's typed reason into the second. Regression test
 * for `key={at}` (`EditDay.tsx`).
 *
 * Two updates, each with one photograph, both removed in the same save —
 * `emptiedEntries()` then queues both indices. The claim under test is what
 * each update's own PATCH body carries: two distinct `declined.media`
 * reasons, one per update, not one sentence copied into both.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function setInputValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const day: Day = {
  date: "2026-09-01",
  entries: [
    {
      slug: "erster-tag",
      title: "Erster Tag",
      date: "2026-09-01",
      location: "Bellinzona",
      country: "Switzerland",
      gallery: [{ src: "a.jpg" } as never],
      tags: [],
      costs: [],
      content: "Ankunft.",
    } as unknown as Day["entries"][number],
    {
      slug: "erster-tag-2",
      title: "Zweiter Eintrag",
      date: "2026-09-01",
      location: "Bellinzona",
      country: "Switzerland",
      gallery: [{ src: "b.jpg" } as never],
      tags: [],
      costs: [],
      content: "Abends.",
    } as unknown as Day["entries"][number],
  ],
} as unknown as Day;
day.lead = day.entries[0];

describe("EditDay, confirmBeforeSave — B1899's same shape, two emptied galleries in one save", () => {
  test("each update's PATCH carries its own decline reason, not the other's", async () => {
    const patchBodies: Record<string, Record<string, unknown>> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH" && url.includes("erster-tag-2")) {
          patchBodies["erster-tag-2"] = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (init?.method === "PATCH") {
          patchBodies["erster-tag"] = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        // The mount-time GET (version fetch) for each entry.
        return new Response(JSON.stringify({ etag: '"abc"' }), { status: 200 });
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <EditDay
            username="alex"
            tripId="reise"
            day={day}
            // Both galleries emptied before mount — the panel's own way of
            // marking a removal already decided, same as pressing "Remove"
            // on the sole photograph of each update would.
            initialDrop="a.jpg"
            confirmBeforeSave
            onClose={() => {}}
          />
        </LocaleProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Drop the second update's own photograph too, via its "Remove" button.
    const removeButtons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Remove",
    );
    expect(removeButtons.length).toBeGreaterThan(0);
    await act(async () => {
      removeButtons[removeButtons.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement;
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The decline queue: two entries, one screen at a time (E3✗).
    let textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    await act(async () => {
      setInputValue(textarea, "the only photograph of the first update was removed");
    });
    let confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "That is the reason") as HTMLButtonElement;
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Second entry's own decline screen — the leak check: without
    // `key={at}`, React reuses the same instance and this textarea would
    // start non-empty, still holding the first update's own sentence.
    textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe("");
    await act(async () => {
      setInputValue(textarea, "the second update's own photograph was pulled instead");
    });
    confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "That is the reason") as HTMLButtonElement;
    await act(async () => {
      confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Preview, then the real save.
    const commitButton = Array.from(container.querySelectorAll("button")).find((b) => /^Save \d+ changes?$/.test(b.textContent ?? "")) as HTMLButtonElement;
    expect(commitButton).toBeTruthy();
    await act(async () => {
      commitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstPatch = patchBodies["erster-tag"] as { declined?: { media?: string } };
    const secondPatch = patchBodies["erster-tag-2"] as { declined?: { media?: string } };
    expect(firstPatch?.declined?.media).toBe("the only photograph of the first update was removed");
    expect(secondPatch?.declined?.media).toBe("the second update's own photograph was pulled instead");
    expect(firstPatch?.declined?.media).not.toBe(secondPatch?.declined?.media);
  });
});

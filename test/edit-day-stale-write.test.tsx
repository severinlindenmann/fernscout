// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import EditDay from "@/components/EditDay";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day } from "@/lib/types";

/**
 * D12 — a save refused with `stale_document` must actually replace the
 * panel with the refusal screen. Found live, driving two tabs against a
 * real day in `content/example`: `EditDay`'s render checked `previewOpen`
 * before `staleConflict`, so a 409 correctly refused the write and set
 * `staleConflict` — and the confirm screen kept rendering over it anyway,
 * because `previewOpen` was still `true` and was checked first. The person
 * saw their own typed change sitting on screen with a live "Save N changes"
 * button, exactly as if the press had done nothing — the one shape D12
 * explicitly forbids ("never applied silently" reads both ways: never
 * written silently, and never *refused* silently either). This is the
 * regression test for the fix (`EditDay.tsx`: `staleConflict` checked
 * first, and `save()` itself clears `previewOpen` on a 409 as the belt).
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

const day: Day = {
  date: "2026-09-01",
  entries: [
    {
      slug: "erster-tag",
      title: "Erster Tag",
      date: "2026-09-01",
      location: "Bellinzona",
      country: "Switzerland",
      lat: 46.1944,
      lng: 9.0175,
      gallery: [],
      tags: [],
      costs: [],
      content: "Ankunft.",
    } as unknown as Day["entries"][number],
  ],
} as unknown as Day;
day.lead = day.entries[0];

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("EditDay, confirmBeforeSave — D12's stale refusal actually replaces the panel", () => {
  test("a 409 shows the refusal screen, not the confirm screen still sitting there", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(
            JSON.stringify({ error: "stale_document", message: "moved on", details: { title: "Somebody else's title" } }),
            { status: 409 },
          );
        }
        // The GET version-fetch on mount.
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
            confirmBeforeSave
            onClose={() => {}}
          />
        </LocaleProvider>,
      );
    });
    // Let the mount-time GET (version fetch) resolve.
    await act(async () => {
      await Promise.resolve();
    });

    const title = container.querySelector('input[aria-label], input') as HTMLInputElement;
    const titleInput = Array.from(container.querySelectorAll("input")).find((i) => i.value === "Erster Tag") as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    await act(async () => {
      typeInto(titleInput, "A new title");
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement;
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The preview/confirm screen (E3) is showing now, with the real diff.
    expect(container.textContent).toContain("What this save changes");
    const confirmButton = Array.from(container.querySelectorAll("button")).find((b) => /^Save \d+ changes?$/.test(b.textContent ?? ""));
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The refusal screen, not the confirm screen still sitting there.
    expect(container.textContent).toContain("This changed while you had it open");
    expect(container.textContent).not.toContain("What this save changes");
    expect(container.querySelector("input")).toBeNull(); // no form left to type into
  });
});

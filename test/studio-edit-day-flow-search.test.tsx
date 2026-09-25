// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import EditDayFlow from "@/components/studio/day/EditDayFlow";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { EditablePickerTrip } from "@/lib/studio/editDay";

/**
 * B1954 — the picker's untyped view shows only the two most recent trips
 * (two entries each); cutting that list must not cut what the search box
 * can find. Same jsdom + `createRoot` harness as `test/day-notify-nobody.test.tsx`.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

// Three trips, so the third — and its one entry — is outside the
// two-trip cut. `daysForEditPicker` (server-side) is what would normally
// order these; the flow itself trusts whatever order it is handed, so the
// fixture states its own "most recent first" order directly.
const picker: EditablePickerTrip[] = [
  {
    tripId: "recent",
    tripTitle: "Most Recent Trip",
    days: [{ date: "2026-09-18", entries: [{ slug: "recent-1", title: "A recent day", status: "published" }] }],
  },
  {
    tripId: "second",
    tripTitle: "Second Trip",
    days: [{ date: "2026-08-01", entries: [{ slug: "second-1", title: "A second-trip day", status: "published" }] }],
  },
  {
    tripId: "buried",
    tripTitle: "Buried Trip",
    days: [{ date: "2019-01-01", entries: [{ slug: "buried-1", title: "The Susten Pass in the rain", status: "published" }] }],
  },
];

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <EditDayFlow username="alex" picker={picker} editable={null} />
      </LocaleProvider>,
    );
  });
}

describe("EditDayFlow — B1954's own trim", () => {
  test("the untyped picker shows only the two most recent trips, with a Show more button", () => {
    return render().then(() => {
      expect(container!.textContent).toContain("Most Recent Trip");
      expect(container!.textContent).toContain("Second Trip");
      // The third trip, and its one entry, are cut — not merely scrolled
      // past.
      expect(container!.textContent).not.toContain("Buried Trip");
      expect(container!.textContent).not.toContain("The Susten Pass in the rain");
      expect(container!.textContent).toContain("Show more");
    });
  });

  test("typing a search that only matches the cut-out trip still finds it", async () => {
    await render();
    const input = container!.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "susten");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Search reaches the entry the untyped view cut, and the trips that
    // were showing before the query no longer clutter the results.
    expect(container!.textContent).toContain("The Susten Pass in the rain");
    expect(container!.textContent).toContain("Buried Trip");
    expect(container!.textContent).not.toContain("Most Recent Trip");
  });

  test("pressing Show more reveals the cut trip without needing a search", async () => {
    await render();
    const buttons = Array.from(container!.querySelectorAll("button"));
    const showMore = buttons.find((b) => b.textContent === "Show more")!;
    expect(showMore).toBeDefined();

    await act(async () => {
      showMore.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container!.textContent).toContain("Buried Trip");
    expect(container!.textContent).toContain("The Susten Pass in the rain");
  });
});

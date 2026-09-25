// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import EditDayFlow from "@/components/studio/day/EditDayFlow";
import ReshapeDayFlow from "@/components/studio/day/ReshapeDayFlow";
import LocaleProvider from "@/components/LocaleProvider";
import StudioBarProvider from "@/components/studio/StudioBar";
import { dictionaryFor } from "@/lib/locales";
import type { EditablePickerTrip } from "@/lib/studio/editDay";

// B2136 — reshape and the figure creator keep their step in the URL (`useStep`).
vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/reshape"));

/**
 * B1881 — the "Change a day" picker listed one row per day (its lead entry
 * only), so a day's second entry — the example journal's two Lisbon
 * entries, both 2025-11-15 — was not findable by its own title, and opening
 * that row edited both entries together. This drives the actual rendered
 * pickers (not just the data layer, `test/studio-edit-day.test.ts`) and
 * asserts both entries appear as separately clickable rows, each with its
 * own title and its own link — a test that only checked the picker
 * rendered *something* would still pass against the broken one-row-per-day
 * shape, since it always rendered exactly one row too.
 */

const PICKER: EditablePickerTrip[] = [
  {
    tripId: "portugal",
    tripTitle: "Portugal",
    days: [
      {
        date: "2025-11-15",
        entries: [
          { slug: "into-italy", title: "Into Italy", time: "09:00", status: "published" },
          { slug: "we-stayed-for-dinner", title: "We stayed for dinner", time: "19:30", status: "published" },
        ],
      },
    ],
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  resetNavigation();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    // Both flows live under the studio layout's bar provider (B2110: the
    // reshape intro's primary registers there).
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    );
  });
}

describe("EditDayFlow's picker (E1) — both Lisbon entries of 2025-11-15", () => {
  test("appear separately, each with its own title and its own link", () => {
    render(<EditDayFlow username="alex" picker={PICKER} editable={null} />);

    const links = Array.from(container!.querySelectorAll("a[href*='/studio/day/edit?slug=']")) as HTMLAnchorElement[];

    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(container!.textContent).toContain("Into Italy");
    expect(container!.textContent).toContain("We stayed for dinner");

    const intoItaly = links.find((a) => a.textContent?.includes("Into Italy"));
    const dinner = links.find((a) => a.textContent?.includes("We stayed for dinner"));
    expect(intoItaly).toBeTruthy();
    expect(dinner).toBeTruthy();
    // Selecting one addresses that entry alone — different hrefs, not the
    // day's lead slug repeated for both.
    expect(intoItaly!.getAttribute("href")).toContain("slug=into-italy");
    expect(dinner!.getAttribute("href")).toContain("slug=we-stayed-for-dinner");
    expect(intoItaly!.getAttribute("href")).not.toBe(dinner!.getAttribute("href"));
  });

  test("B2139 — dates read as words with their year, never ISO", () => {
    const single: EditablePickerTrip[] = [{ ...PICKER[0], days: [{ date: "2025-11-15", entries: [PICKER[0].days[0].entries[0]] }] }];
    render(<EditDayFlow username="alex" picker={single} editable={null} />);
    expect(container!.textContent).toContain("Saturday, 15 November 2025");
    expect(container!.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("ReshapeDayFlow's own picker inherited the same shape — now fixed too", () => {
  test("both entries are separately selectable, on 'which day' and 'join with which other day'", () => {
    render(<ReshapeDayFlow username="alex" picker={PICKER} trips={[{ id: "portugal", title: "Portugal" }]} />);

    // Get to the picker: what → pick operation (merge, since that is the
    // one that walks the picker twice) → pick day.
    const startBtn = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.includes("what's wrong"));
    act(() => startBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const mergeBtn = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.includes("Join two days into one"));
    act(() => mergeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    // Both Lisbon entries are their own buttons, not one row for the day.
    const rowButtons = Array.from(container!.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Into Italy") || b.textContent?.includes("We stayed for dinner"),
    );
    expect(rowButtons).toHaveLength(2);
  });
});

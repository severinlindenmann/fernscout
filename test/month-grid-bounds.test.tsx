// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import MonthGrid from "@/components/studio/day/MonthGrid";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { clampDate } from "@/lib/studio/monthGrid";

/**
 * B2823 — "Pick a day" in a trip wholly in the future gave the grid
 * min (trip start) > max (today): the render-time clamp flipped between the two
 * ends forever, React error 301.
 */
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

async function mount(min: string, max: string, band: { start: string; end: string }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <MonthGrid value="" onChange={() => {}} min={min} max={max} band={band} />
      </LocaleProvider>,
    ),
  );
}

describe("MonthGrid bounds", () => {
  test("a future-only trip (min after max) renders, on the trip's month, every day disabled", async () => {
    await mount("2026-10-10", "2026-10-03", { start: "2026-10-10", end: "2026-10-12" });
    expect(container.textContent).toContain("October 2026");
    expect(container.querySelectorAll("button[data-date]:not([disabled])")).toHaveLength(0);
  });
  test("a past-only trip renders", async () => {
    await mount("2026-08-01", "2026-10-03", { start: "2026-08-01", end: "2026-08-05" });
    expect(container.querySelectorAll("button[data-date]:not([disabled])").length).toBeGreaterThan(0);
  });
  test("a trip that includes today renders and today is choosable", async () => {
    await mount("2026-10-01", "2026-10-03", { start: "2026-10-01", end: "2026-10-09" });
    expect(container.querySelector('button[data-date="2026-10-03"]')?.hasAttribute("disabled")).toBe(false);
  });
  test("clampDate is stable on inverted bounds", () => {
    const once = clampDate("2026-10-03", "2026-10-10", "2026-10-03");
    expect(clampDate(once, "2026-10-10", "2026-10-03")).toBe(once);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import PositionsTable, { type DisplayRow } from "@/components/studio/location/PositionsTable";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2563 T5 — the Positions tab's own client island. Coordinates blurred by
 * default (D11: nothing copyable at a glance on a shared screen), the
 * "Show coordinates" toggle lifting the blur, and a row click filling the
 * detail card — the three behaviours a unit test on `lib/gps/positionRows.ts`
 * alone cannot prove, since they are DOM state, not arithmetic.
 */

// Same mocking `test/day-stretch-editor-save.test.tsx` already does for
// these two map components, which both reach a real MapLibre/world-map
// bundle this test has no need to load.
vi.mock("@/components/studio/location/DayLineMap", () => ({ default: () => null }));
vi.mock("@/components/WorldMap", () => ({ default: () => null }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const ROWS: DisplayRow[] = [
  {
    kind: "fix",
    index: 0,
    lat: 46.72,
    lon: 8.18,
    timeLabel: "07:02",
    modeLabel: "on foot",
    storedMode: "on_foot",
    place: "Meiringen",
    distanceLabel: undefined,
    speedLabel: undefined,
    hiddenBy: undefined,
    epochSeconds: 1_726_210_920,
  },
  { kind: "gap", label: "No positions for 1 h 08 min" },
  {
    kind: "fix",
    index: 1,
    lat: 46.7,
    lon: 8.2,
    timeLabel: "09:48",
    modeLabel: "by car",
    storedMode: "car",
    place: "Innertkirchen",
    distanceLabel: "1234 m",
    speedLabel: "12.3 km/h",
    hiddenBy: "Hidden spot",
    epochSeconds: 1_726_215_600,
  },
];

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <PositionsTable
          rows={ROWS}
          points={[
            [46.72, 8.18],
            [46.7, 8.2],
          ]}
          gapAfter={[true]}
          streetMapsOn={false}
          timezone="Europe/Zurich"
          summary="2 stored positions · 1 inside a hidden spot"
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
}

describe("PositionsTable", () => {
  test("coordinates are blurred by default and the toggle reveals them", async () => {
    await render();
    const latCell = [...container!.querySelectorAll("td")].find((td) => td.textContent === "46.72000");
    expect(latCell).toBeDefined();
    expect(latCell!.className).toContain("blur-sm");

    const toggle = [...container!.querySelectorAll("button")].find(
      (b) => b.textContent === dictionaryFor("en")["studio.location.positions.reveal.show"],
    );
    expect(toggle).toBeDefined();
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });

    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle!.textContent).toBe(dictionaryFor("en")["studio.location.positions.reveal.hide"]);
    const latCellAfter = [...container!.querySelectorAll("td")].find((td) => td.textContent === "46.72000");
    expect(latCellAfter!.className).not.toContain("blur-sm");
  });

  test("clicking a row fills the detail card with that row's own facts", async () => {
    await render();
    const rows = [...container!.querySelectorAll('tr[role="button"]')];
    expect(rows).toHaveLength(2);
    const secondRow = rows[1];
    await act(async () => {
      secondRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const detail = container!.textContent ?? "";
    expect(detail).toContain("09:48 · Europe/Zurich");
    expect(detail).toContain("Innertkirchen");
    expect(detail).toContain("Hidden spot");
    // The detail card's own mode line, "{mode}, from the phone".
    expect(detail).toContain("by car, from the phone");
  });

  test("the summary line and the gap row both render, and the gap row is never clickable", async () => {
    await render();
    expect(container!.textContent).toContain("2 stored positions · 1 inside a hidden spot");
    const gapRow = [...container!.querySelectorAll("tr")].find((tr) => tr.textContent === "No positions for 1 h 08 min");
    expect(gapRow).toBeDefined();
    expect(gapRow!.getAttribute("role")).not.toBe("button");
  });
});

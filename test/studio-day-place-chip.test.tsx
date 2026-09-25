// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import AddDayFlow from "@/components/studio/day/AddDayFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B2227 — the place chip names the day being written, not any chosen photo.
 * Before the fix `photoPlace = chosenPhotos.find((i) => i.location || i.country)`
 * read the first chosen photo with a place at all, so a Geneva photo from
 * April outranked two Porto photos from the day itself once all three were
 * chosen. The fix restricts the "most common place" reading to the
 * photographs whose own day matches the date being written — the same rule
 * `groupWaitingDays` gives the hub's day cards.
 */

const DAY = "2026-01-05";
const PORTO_A = { id: "porto-a", filename: "porto-a.jpg", bytes: 1, uploadedAt: "2026-01-05T09:00:00.000Z", takenAt: "2026-01-05T09:00:00", location: "Porto", country: "Portugal" };
const PORTO_B = { id: "porto-b", filename: "porto-b.jpg", bytes: 1, uploadedAt: "2026-01-05T10:00:00.000Z", takenAt: "2026-01-05T10:00:00", location: "Porto", country: "Portugal" };
// Brought into the inbox before the Porto photos, so the old bug — the
// first chosen photo with *any* place, regardless of its own day — picked
// this one.
const GENEVA = { id: "geneva-c", filename: "geneva-c.jpg", bytes: 1, uploadedAt: "2026-01-01T00:00:00.000Z", takenAt: "2026-04-01T10:00:00", location: "Geneva", country: "Switzerland" };

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  resetNavigation();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("AddDayFlow — B2227, the place chip reads only this day's photographs", () => {
  test("a photo from another day never outranks this day's own place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/inbox")) return Response.json({ media: [PORTO_A, PORTO_B, GENEVA] });
        return Response.json({});
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <StudioBarProvider username="alex">
            <AddDayFlow
              username="alex"
              trips={[{ id: "reise", title: "Reise", start: "2026-01-01", end: "2026-01-31" }]}
              // A non-empty history turns off the first-run wizard, so the
              // whole page — including the place chip — renders at once.
              writtenDatesByTrip={{ reise: ["2026-01-02"] }}
              proposal={null}
              weatherAvailable={false}
              // B2232 — the day's own two photos join from its hub card.
              initialPhotos={DAY}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    const c = container!;
    // Open "more waiting" and choose the Geneva photo from another day too —
    // the reported scenario: every waiting photograph chosen.
    await act(async () => {
      for (const d = c.querySelector("[data-waiting-photos]") as HTMLDetailsElement | null; d; ) {
        d.open = true;
        break;
      }
    });
    const genevaTile = c.querySelector('[data-photo="geneva-c.jpg"]') as HTMLButtonElement | null;
    expect(genevaTile).not.toBeNull();
    await act(async () => genevaTile!.click());

    const chip = c.querySelector('[data-chip="place"]') as HTMLButtonElement;
    expect(chip.textContent).toContain("Porto");
    expect(chip.textContent).not.toContain("Geneva");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import AddDayFlow from "@/components/studio/day/AddDayFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { declinableFieldsFor } from "@/lib/studio/declinables";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * D1, as amended by B2191 (owner decision D7, 2026-09-24): unanswered
 * declinables are named at share time (B2192), never asked field by field
 * while writing. Until B2188 "Add a day" ended in an eleven-row "Still open"
 * wall of reason dropdowns (B2078's A5), asked of every draft.
 *
 * This pins the writing half: with every part of the page open — photographs
 * chosen, the date sheet, the place sheet and "More details" — the page holds
 * no reason dropdown and no field-by-field question for any declinable, and
 * the write declines nothing on the person's behalf. The one `<select>` the
 * page may show is the date sheet's trip picker, which is not a declinable.
 */

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

const PHOTO = {
  id: "p1",
  filename: "p1.jpg",
  bytes: 10,
  uploadedAt: "2025-11-10T10:00:00.000Z",
  takenAt: "2025-11-05T09:00:00",
  lat: 46.2,
  lon: 9.0,
};

describe("AddDayFlow — D1, declinables are named at share time, never asked while writing", () => {
  test("the one page asks no declinable field by field and the write declines nothing", async () => {
    let commitBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/inbox")) return Response.json({ media: [PHOTO] });
        if (url.includes("/day/new")) {
          commitBody = JSON.parse(String(init?.body ?? "{}"));
          return Response.json({ ok: true, slug: "2025-11-05-a-day" }, { status: 201 });
        }
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
              trips={[
                { id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" },
                { id: "andere", title: "Andere", start: "2025-11-01", end: "2025-11-30" },
              ]}
              writtenDatesByTrip={{ reise: ["2025-11-02"], andere: [] }}
              proposal={null}
              weatherAvailable
              // B2232 — a waiting photograph joins a day from its hub card.
              initialPhotos="2025-11-05"
            />
          </StudioBarProvider>
        </LocaleProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    const c = container!;
    // One sheet at a time: the date sheet holds the only select there is.
    await act(async () => (c.querySelector('[data-chip="date"]') as HTMLButtonElement).click());
    const selects = [...c.querySelectorAll("select")];
    expect(selects.map((s) => [...s.options].map((o) => o.value))).toEqual([["reise", "andere"]]);
    await act(async () => (c.querySelector('[data-chip="place"]') as HTMLButtonElement).click());
    expect(c.querySelectorAll("select")).toHaveLength(0);
    await act(async () => {
      for (const d of c.querySelectorAll("details")) d.open = true;
    });
    expect(c.querySelectorAll("details").length).toBeGreaterThan(0);

    expect(c.querySelectorAll('[name^="reason-"]')).toHaveLength(0);
    expect(c.querySelector('[role="switch"]')).toBeNull();
    const words = c.textContent ?? "";
    for (const phrase of ["Still open", "nobody recorded", "Mark all as not recorded", "not recorded"]) {
      expect(words, phrase).not.toContain(phrase);
    }
    // None of the twelve declinables is asked as its own question.
    const fields = declinableFieldsFor(["en", "de"]).map((d) => d.field);
    expect(fields.length).toBeGreaterThan(8);
    for (const field of fields) expect(c.querySelector(`[name="reason-${field}"], [name="reason-text-${field}"]`), field).toBeNull();

    const save = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save privately")!;
    await act(async () => save.click());
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(commitBody).not.toBeNull();
    expect((commitBody as unknown as { declined: Record<string, string> }).declined).toEqual({});
  });
});

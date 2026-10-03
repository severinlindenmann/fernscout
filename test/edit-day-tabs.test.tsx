// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import EditDay from "@/components/EditDay";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day } from "@/lib/types";

/** B2764 — language tabs only for translations the day has; the title is a
 *  labelled field; Manage keeps the take-down and whatever the caller adds. */
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

function dayWith(translations?: Record<string, { title: string; content: string }>): Day {
  const entry = {
    slug: "erster-tag", title: "Erster Tag", date: "2026-09-01", location: "Bellinzona", country: "Switzerland",
    gallery: [], tags: [], costs: [], content: "Ankunft.", translations,
  };
  return { date: "2026-09-01", entries: [entry], lead: entry } as unknown as Day;
}

async function mount(day: Day) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ etag: '"a"' }), { status: 200 })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <EditDay username="alex" tripId="reise" day={day} originalLocale="de" manage={<button>Delete it</button>} onClose={() => {}} />
      </LocaleProvider>,
    );
  });
}
const tabs = () => Array.from(container!.querySelectorAll('[role="tab"]')).map((b) => b.textContent);

describe("EditDay language tabs and labels", () => {
  test("no tab bar when the day has no translation", async () => {
    await mount(dayWith());
    expect(tabs()).toEqual([]);
    expect(container!.textContent).toContain("Title");
    expect(container!.textContent).toContain("What happened");
  });

  test("tabs are the original plus each existing translation, and switch only the words", async () => {
    await mount(dayWith({ en: { title: "First day", content: "Arrived." } }));
    expect(tabs()).toEqual(["German · original", "English"]);
    const english = container!.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement;
    await act(async () => english.click());
    expect(container!.textContent).toContain("Title in English");
    expect(Array.from(container!.querySelectorAll("input")).some((i) => i.value === "First day")).toBe(true);
    // Details and Manage are on every tab.
    expect(container!.textContent).toContain("Day details");
    expect(container!.textContent).toContain("Take this day off the site");
    expect(container!.textContent).toContain("Delete it");
  });
});

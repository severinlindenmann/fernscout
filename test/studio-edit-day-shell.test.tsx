// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import EditDayFlow from "@/components/studio/day/EditDayFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { EditableDay } from "@/lib/studio/editDay";
import type { Entry } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * B2073 — "Change a day" on the studio shell: a draft says so, Save is the
 * bar's one primary and cannot be pressed before the form is live or before
 * anything moved, the trip's own audience is not in the day's form, an
 * emptied title is refused under the title, and a save stays on the page
 * and says "Saved.".
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function editable(title = "A day", draft = true): EditableDay {
  const entry = {
    slug: "a-day",
    date: "2025-11-01",
    title,
    location: "Bellinzona",
    country: "Switzerland",
    gallery: [],
    tags: [],
    costs: [],
    content: "Words.",
    draft,
  } as unknown as Entry;
  return { tripId: "reise", tripTitle: "Reise", day: { date: entry.date, entries: [entry], lead: entry } };
}

function tree(day: EditableDay) {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <EditDayFlow username="alex" picker={[]} editable={day} />
      </StudioBarProvider>
    </LocaleProvider>
  );
}

async function mount(day: EditableDay) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(tree(day)));
  // The mount-time version read.
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/** The bar's one Save — `StepPrimary` registers it into the studio bar at
 *  every width, so there is exactly one in the document. */
const save = () => {
  const found = Array.from(container!.querySelectorAll("button")).filter((b) => /^Save( \d+ changes?)?$/.test(b.textContent ?? ""));
  expect(found).toHaveLength(1);
  return found[0] as HTMLButtonElement;
};
const titleInput = () => Array.from(container!.querySelectorAll("input")).find((i) => i.value === "A day" || i.getAttribute("aria-invalid") !== null) as HTMLInputElement;

function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function stubFetch(onPatch?: (body: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") onPatch?.(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ etag: '"abc"' }), { status: 200 });
    }),
  );
}

describe("day/edit on the studio shell — B2073", () => {
  test("a draft wears the yellow pill and names where publishing lives", async () => {
    stubFetch();
    await mount(editable());
    const pill = container!.querySelector("[data-draft-pill]")!;
    expect(pill.querySelector(".bg-yellow-50")?.textContent).toBe("Draft");
    expect(pill.textContent).toContain("Nobody can read it yet");
  });

  test("the server render carries no pressable Save — nothing can be pressed before the form is live", () => {
    const html = renderToStaticMarkup(tree(editable()));
    expect(html).toContain("Correct this day");
    // B2139 — at zero changes the button says just "Save".
    const saves = [...html.matchAll(/<button([^>]*)>(?:(?!<\/button>).)*Save(?: \d+ change|<)/g)];
    expect(saves.every((m) => /disabled/.test(m[1]))).toBe(true);
  });

  test("Save is disabled at mount and enabled, with the count, after a change", async () => {
    stubFetch();
    await mount(editable());
    expect(save().disabled).toBe(true);
    // B2139 — no "Save 0 changes": at zero it is just Save.
    expect(save().textContent).toBe("Save");
    await act(async () => typeInto(titleInput(), "A better day"));
    expect(save().disabled).toBe(false);
    expect(save().textContent).toBe("Save 1 change");
  });

  test("B2138: a title and a caption edited count as two changes", async () => {
    stubFetch();
    const day = editable();
    (day.day.entries[0] as unknown as { gallery: { src: string; caption?: string }[] }).gallery = [{ src: "/a.jpg", caption: "" }];
    await mount(day);
    await act(async () => typeInto(titleInput(), "A better day"));
    const caption = container!.querySelector('input[placeholder="Caption"]') as HTMLInputElement;
    await act(async () => typeInto(caption, "The lake"));
    expect(save().textContent).toBe("Save 2 changes");
  });

  test("the day's form carries no trip-level control", async () => {
    stubFetch();
    await mount(editable());
    const form = container!.querySelector('section[aria-label="Correct this day"]')!;
    expect(form).toBeTruthy();
    expect(form.textContent).not.toMatch(/advertis|who may read this trip/i);
    expect(form.querySelector('option[value="public"]')).toBeNull();
    expect(form.querySelector('input[type="checkbox"]')).toBeNull();
    // It says where those live instead.
    const link = Array.from(container!.querySelectorAll("a")).find((a) => a.textContent?.includes("Trips"));
    expect(link?.getAttribute("href")).toBe("/alex/studio/trip?trip=reise");
  });

  test("an emptied title is refused under the title field, and Save stays disabled", async () => {
    stubFetch();
    await mount(editable());
    const input = titleInput();
    await act(async () => typeInto(input, ""));
    const alert = input.closest("label")!.nextElementSibling as HTMLElement;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("A title is needed to save.");
    expect(save().disabled).toBe(true);
  });

  test("a save writes, re-reads the page and says Saved. without leaving", async () => {
    const bodies: unknown[] = [];
    stubFetch((b) => bodies.push(b));
    await mount(editable());
    await act(async () => typeInto(titleInput(), "A better day"));
    await act(async () => save().click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(bodies).toEqual([{ title: "A better day" }]);
    expect(refresh).toHaveBeenCalled();
    // The refreshed page hands the flow the day as it now stands.
    await act(async () => root!.render(tree(editable("A better day"))));
    expect(container!.querySelector("h2")?.textContent).toBe("A better day");
    expect(container!.querySelector('[role="status"]')?.textContent).toBe("Saved.");
    // Still a draft: saving never publishes.
    expect(container!.querySelector("[data-draft-pill]")).not.toBeNull();
  });
});

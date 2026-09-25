// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import AddDayFlow from "@/components/studio/day/AddDayFlow";
import EditDayFlow from "@/components/studio/day/EditDayFlow";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { EditableDay } from "@/lib/studio/editDay";
import type { Entry } from "@/lib/types";


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// AddDayFlow keeps its step in the URL (`useStep`, B2078); its router also
// carries the `refresh` `EditDayFlow` calls after a save (B2073). One mock:
// a second `vi.mock` of the same module raced this one and failed now and then.
vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B2058 — "Go to publishing" on the day-created screen used to open
 * `studio/day/edit`, a form with no publishing on it. Publish lives on the
 * day's own page (`OwnerTools`), so the link goes there; and `day/edit`
 * says a draft is a draft, and where it is published from, without offering
 * to publish it.
 *
 * B2140 — publishing has its own studio page now, so both links go there
 * with the day preselected; `day/edit` still offers no publish button.
 *
 * Same jsdom + `createRoot` harness as `test/add-day-asks-no-declinables.test.tsx`.
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

async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        {node}
      </LocaleProvider>,
    );
  });
}

describe("the day-created screen", () => {
  test("the publishing link opens the studio's publish page with the new day chosen (B2140)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/day/for-date")) return new Response(JSON.stringify({ existing: null }), { status: 200 });
        if (url.includes("/inbox")) return new Response(JSON.stringify({ media: [] }), { status: 200 });
        if (url.includes("/day/new")) {
          return new Response(JSON.stringify({ ok: true, slug: "2025-11-01-a-day" }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    await mount(
      <StudioBarProvider username="alex">
        <AddDayFlow
          username="alex"
          trips={[{ id: "reise", title: "Reise", start: "2025-01-01", end: "2025-12-31" }]}
          writtenDatesByTrip={{ reise: ["2025-10-31"] }}
          proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-01" }}
        />
      </StudioBarProvider>,
    );

    // B2188 — one page: Save privately is the bar's one primary.
    await act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save privately")!.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // D5 — "Share this day", a quiet link beside Done (B2188); "Open the day"
    // and "Add another day" went with the what-next cards (no nudges).
    const link = [...container!.querySelectorAll("a")].find((a) => a.textContent?.trim() === "Share this day ›");
    expect(link, container!.innerHTML.slice(0, 400)).toBeTruthy();
    // The route answers with the dated v2 id; the publish page wants the bare slug.
    expect(link!.getAttribute("href")).toBe("/alex/studio/day/publish?day=a-day&trip=reise");
  });
});

function editable(draft: boolean): EditableDay {
  const entry = {
    slug: "a-day",
    date: "2025-11-01",
    title: "A day",
    location: "Bellinzona",
    country: "Switzerland",
    gallery: [],
    tags: [],
    costs: [],
    content: "",
    draft,
  } as unknown as Entry;
  return {
    tripId: "reise",
    tripTitle: "Reise",
    day: { date: entry.date, entries: [entry], lead: entry },
  };
}

describe("day/edit", () => {
  function stubVersionFetch() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ etag: '"abc"' }), { status: 200 })));
  }

  test("a draft wears a Draft pill that links to publishing it (B2140)", async () => {
    stubVersionFetch();
    // B2073 — the flow's Save is the studio bar's primary; the page is
    // only ever mounted under the studio layout's provider.
    await mount(
      <StudioBarProvider username="alex">
        <EditDayFlow username="alex" picker={[]} editable={editable(true)} />
      </StudioBarProvider>,
    );
    const pill = container!.querySelector("[data-draft-pill]");
    expect(pill?.textContent).toContain("Draft");
    expect(pill?.querySelector("a")?.getAttribute("href")).toBe("/alex/studio/day/publish?day=a-day&trip=reise");
    expect(pill?.querySelector("button")).toBeNull();
  });

  test("a published day wears none", async () => {
    stubVersionFetch();
    // B2073 — the flow's Save is the studio bar's primary; the page is
    // only ever mounted under the studio layout's provider.
    await mount(
      <StudioBarProvider username="alex">
        <EditDayFlow username="alex" picker={[]} editable={editable(false)} />
      </StudioBarProvider>,
    );
    expect(container!.querySelector("[data-draft-pill]")).toBeNull();
  });
});

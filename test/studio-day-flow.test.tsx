// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pushed: string[] = [];
vi.mock("next/navigation", async () => {
  const base = (await import("./fixtures/fakeNavigation")).navigationMock("/@alex/studio/day/new");
  return {
    ...base,
    useRouter: () => ({ ...base.useRouter(), push: (href: string) => pushed.push(href) }),
  };
});

vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

/**
 * B2676 (V2.1) — the Write page. There is no assistant gate in front of it
 * any more (`DayFlow` is a thin wrapper now; its own removed "with/without
 * the assistant" and "Check your day" coverage moved — the first is simply
 * gone, `RecordButton`'s own consent covers the microphone, and the second
 * is Preview's, B2677, not built here). What is left to prove at this
 * level: a long day offered in parts stays stacked on the one page, and
 * saving writes every part in order (the first a second entry only when
 * accepted, every later one always is) before navigating to the Preview
 * stand-in.
 */

const { default: DayFlow } = await import("@/components/studio/day/DayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: StudioPage } = await import("@/components/studio/StudioPage");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

const dict = dictionaryFor("en");
const TRIPS = [{ id: "utah", title: "Utah", start: "2025-09-01", end: "2025-09-30" }];
const photo = (id: string, time: string, lat: number, lon: number) => ({
  id,
  filename: `${id}.jpg`,
  bytes: 10,
  uploadedAt: "2025-09-08T00:00:00Z",
  takenAt: `2025-09-07T${time}:00`,
  lat,
  lon,
});
// One long day: Bryce at dawn, the byway around noon, Capitol Reef at dusk.
const INBOX = [
  photo("b1", "06:02", 37.62, -112.16),
  photo("b2", "06:40", 37.62, -112.16),
  photo("b3", "07:40", 37.63, -112.17),
  photo("e1", "11:20", 37.77, -111.6),
  photo("e2", "12:05", 37.78, -111.6),
  photo("c1", "16:15", 38.28, -111.25),
  photo("c2", "17:00", 38.28, -111.25),
  photo("c3", "18:30", 38.29, -111.25),
];

let root: Root | undefined;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let props: Record<string, unknown>;
let created = 0;

beforeEach(() => {
  calls = [];
  pushed.length = 0;
  created = 0;
  props = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/inbox")) return Response.json({ media: [...INBOX].reverse() });
      if (url.includes("/day/for-date")) return Response.json({ ok: true, existing: null });
      if (url.includes("/day/new")) {
        created += 1;
        return Response.json({ ok: true, slug: `2025-09-07-part-${created}` }, { status: 201 });
      }
      if (url.includes("/api/helper/alex/day") && method === "PATCH") {
        return Response.json({ ok: true, draft: { slug: body?.slug } });
      }
      return Response.json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dict} locale="en">
        <StudioBarProvider username="alex">
          <StudioPage username="alex" group="write" title="A day">
          <DayFlow
            username="alex"
            trips={TRIPS}
            writtenDatesByTrip={{ utah: ["2025-09-06"] }}
            proposal={null}
            initialPhotos="2025-09-07"
            {...props}
          />
          </StudioPage>
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await flush();
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function button(label: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button ${JSON.stringify(label)} in: ${document.body.textContent}`);
  return b;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await flush();
}
const text = () => document.body.textContent ?? "";
const sent = (part: string, method = "POST") => calls.filter((c) => c.url.includes(part) && c.method === method);

test("with one trip, the date sheet's trip select is still there, and \"+ New trip…\" goes to make one", async () => {
  await mount();
  const dateChip = document.querySelector('[data-chip="date"]') as HTMLButtonElement;
  await act(async () => dateChip.click());
  await flush();
  const select = document.querySelector("select") as HTMLSelectElement;
  expect(select).not.toBeNull();
  expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Utah", dict["studio.day.decide.newTrip"]]);
  await act(async () => {
    select.value = "__new__";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  expect(pushed.at(-1)).toBe("/@alex/studio/trip/new");
});

test("Write opens directly — no assistant screen, the mic is already in the words box", async () => {
  await mount();
  expect(text()).not.toContain("With the AI assistant");
  expect(text()).not.toContain(dict["studio.flow.without"]);
  expect(document.querySelector("[data-fake-mic]")).toBeNull(); // RecordButton isn't mocked here; just the gate is gone
  expect(text()).toContain(dict["studio.day.previewCta"]);
});

describe("a long day's photos fall into parts", () => {
  test("offered inline, and once accepted every part stays stacked on this one page", async () => {
    await mount();
    expect(text()).toContain(dict["studio.flow.splitTitle"].replace("{count}", "3"));
    expect(text()).toContain("Part 1: 06:02–07:40");

    await click(dict["studio.flow.splitYes"].replace("{count}", "3"));
    // Stacked, not stepped — every part's own heading is on the page at once.
    expect(text()).toContain(dict["studio.flow.partHeading"].replace("{index}", "1").replace("{total}", "3"));
    expect(text()).toContain(dict["studio.flow.partHeading"].replace("{index}", "2").replace("{total}", "3"));
    expect(text()).toContain(dict["studio.flow.partHeading"].replace("{index}", "3").replace("{total}", "3"));
    expect(text()).toContain(dict["studio.day.parts.keepAsOne"]);

    await click(dict["studio.day.parts.keepAsOne"]);
    expect(text()).not.toContain(dict["studio.day.parts.keepAsOne"]);
    // Back to one box, and the split offer does not re-open on its own.
    expect(document.querySelector('[data-day-parts]')).toBeNull();
  });

  test("Keep it one day dismisses the offer for this set of photos", async () => {
    await mount();
    expect(text()).toContain(dict["studio.flow.splitTitle"].replace("{count}", "3"));
    await click(dict["studio.flow.splitNo"]);
    expect(text()).not.toContain(dict["studio.flow.splitTitle"].replace("{count}", "3"));
    expect(document.querySelector("[data-day-parts]")).toBeNull();
  });

  test("Preview → saves every part in order, the first plain and every later one a second entry, then goes to Preview", async () => {
    await mount();
    await click(dict["studio.flow.splitYes"].replace("{count}", "3"));
    await click(dict["studio.day.previewCta"]);

    const saves = sent("/day/new");
    expect(saves).toHaveLength(3);
    expect(saves.map((s) => s.body?.mediaInboxIds)).toEqual([["b1", "b2", "b3"], ["e1", "e2"], ["c1", "c2", "c3"]]);
    expect(saves.map((s) => s.body?.time)).toEqual(["06:02", "11:20", "16:15"]);
    expect(saves.map((s) => s.body?.confirmSecondEntry)).toEqual([false, true, true]);
    // B2677 — "Preview →" goes to Preview itself, which finds every part of
    // this trip/date on its own rather than being told their slugs.
    expect(pushed.at(-1)).toBe("/@alex/studio/day/preview?trip=utah&date=2025-09-07");
  });
});

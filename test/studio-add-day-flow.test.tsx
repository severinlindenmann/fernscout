// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { currentSearch, resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B2188 — "Add a day" is one page (it was six screens, B2078). Two files are
 * two photographs, written in the order shown; the date names where it came
 * from and counts honestly; with no dated photograph it asks rather than
 * using today; weather is a removable chip that exists only with the
 * capability; a reload keeps the words; the saved state names who can see
 * the day; a first-time owner gets the same page one part at a time.
 */

const { default: AddDayFlow } = await import("@/components/studio/day/AddDayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const { addDayStorageKey, readAddDaySnapshot } = await import("@/lib/studio/addDayResume");

const TODAY = "2025-11-10";
const TRIPS = [
  { id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" },
  { id: "andere", title: "Eine andere Reise", start: "2025-11-01", end: "2025-11-30" },
];
type Item = { id: string; filename: string; bytes: number; uploadedAt: string; takenAt?: string; lat?: number; lon?: number };
// The inbox lists newest first; 02 was brought in after 01.
const A: Item = { id: "aaa-01.jpg", filename: "01.jpg", bytes: 10, uploadedAt: "2025-11-10T10:00:00.000Z" };
const B: Item = { id: "bbb-02.jpg", filename: "02.jpg", bytes: 10, uploadedAt: "2025-11-10T10:00:01.000Z" };

let root: Root | undefined;
let container: HTMLDivElement;
let commitBody: Record<string, unknown> | null;
let inbox: Item[];
let dayNew: () => Response;
let props: Record<string, unknown>;

beforeEach(() => {
  commitBody = null;
  inbox = [];
  props = {};
  dayNew = () => Response.json({ ok: true, slug: `${TODAY}-a-day` }, { status: 201 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      // Picking the same two files again answers with the same two ids.
      if (url.endsWith("/inbox") && init?.method === "POST") return Response.json({ ok: true, items: [A, B] });
      if (url.endsWith("/inbox")) return Response.json({ media: [...inbox].reverse() });
      if (url.includes("/day/new")) {
        commitBody = JSON.parse(String(init?.body ?? "{}"));
        return dayNew();
      }
      return Response.json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
});

function tree() {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <AddDayFlow
          username="alex"
          trips={TRIPS}
          // A day already written: not a first-time owner.
          writtenDatesByTrip={{ reise: ["2025-11-02"], andere: [] }}
          proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: TODAY }}
          {...props}
        />
      </StudioBarProvider>
    </LocaleProvider>
  );
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(tree()));
  await flush();
}
async function reload() {
  act(() => root!.unmount());
  container.remove();
  await mount();
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}
function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function pickTwoFiles() {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  const files = [new File(["a"], "01.jpg", { type: "image/jpeg" }), new File(["b"], "02.jpg", { type: "image/jpeg" })];
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
}
/** B2232 — waiting photographs from other days are chosen by hand, from
 *  "Add more from what's waiting"; a chosen one's day-mates then join the grid. */
async function chooseEveryWaitingPhoto() {
  for (;;) {
    const next = container.querySelector('[data-photo][aria-pressed="false"]') as HTMLButtonElement | null;
    if (!next) return;
    await act(async () => next.click());
    await flush();
  }
}
const text = () => container.textContent ?? "";
const dateChip = () => container.querySelector('[data-chip="date"]')?.textContent ?? "";

describe("AddDayFlow, one page — B2188", () => {
  test("two files are two photographs, written in the order shown; Save privately writes; saved clears the draft", async () => {
    const errors = vi.spyOn(console, "error");
    await mount();
    // One page: no wizard, no dropdown, nothing to press through.
    expect(container.querySelector("[data-step-indicator]")).toBeNull();
    expect(container.querySelectorAll("select")).toHaveLength(0);

    // No photographs yet: today is inside the current trip, and the chip says so.
    expect(dateChip()).toContain("Reise · day 10");
    expect(dateChip()).toContain("today");

    await pickTwoFiles();
    const tiles = Array.from(container.querySelectorAll("[data-photo]"), (b) => b.getAttribute("data-photo"));
    expect(tiles).toEqual(["01.jpg", "02.jpg"]);
    expect(text()).toContain("2 chosen");

    // Two photographs that carry no date: it asks, rather than keep today.
    expect(dateChip()).toContain("Which day was this?");
    await act(async () => (container.querySelector('[data-chip="date"]') as HTMLButtonElement).click());
    await act(async () => (container.querySelector('button[aria-label^="Monday, 10 November"]') as HTMLButtonElement).click());
    expect(dateChip()).toContain("chosen by you");

    type(container.querySelector("textarea") as HTMLTextAreaElement, "Rain all day, then the river.");
    await flush();
    await click("Save privately");

    const body = commitBody as unknown as Record<string, unknown>;
    expect(body.mediaInboxIds).toEqual([A.id, B.id]);
    expect(body.date).toBe(TODAY);
    expect(body.trip).toBe("reise");
    expect(body.content).toBe("Rain all day, then the river.");
    // C7 — a blank title stays blank; nothing declined for the person.
    expect(body.title).toBe("");
    expect(body.declined).toEqual({});
    expect(body.weather).toBe(false);

    expect(text()).toContain("Saved. Only you can see this day.");
    expect(currentSearch()).toBe("");
    expect(sessionStorage.getItem(addDayStorageKey("alex"))).toBeNull();
    expect(errors.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
  });

  test("a reload keeps the typed words; the hub's snapshot reads the draft", async () => {
    await mount();
    type(container.querySelector("textarea") as HTMLTextAreaElement, "Rain all day");
    await flush();
    expect(readAddDaySnapshot("alex")).toMatchObject({ step: "page", content: "Rain all day" });

    await reload();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Rain all day");
    expect(text()).toContain("You started a day");
    await click("Start a new day instead");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    expect(readAddDaySnapshot("alex")).toBeNull();
  });

  test("the date comes from the photographs, counted honestly, and an outlier is asked about inline", async () => {
    inbox = [
      { ...A, id: "p1", filename: "p1.jpg", takenAt: "2025-11-05T09:00:00" },
      { ...A, id: "p2", filename: "p2.jpg", takenAt: "2025-11-05T12:00:00", uploadedAt: "2025-11-10T10:00:02.000Z" },
      { ...A, id: "p3", filename: "p3.jpg", takenAt: "2025-11-06T01:00:00", uploadedAt: "2025-11-10T10:00:03.000Z" },
      { ...A, id: "p4", filename: "p4.jpg", uploadedAt: "2025-11-10T10:00:04.000Z" },
    ];
    await mount();
    expect(text()).toContain("0 chosen");
    await chooseEveryWaitingPhoto();
    expect(dateChip()).toContain("from 2 of 4 photos");
    expect(dateChip()).toContain("day 5");
    expect(text()).toContain("1 of these was taken on a different day");
    await click("Leave the outliers out");
    expect(text()).toContain("3 chosen");
    expect(text()).not.toContain("taken on a different day");
    await click("Save privately");
    expect((commitBody as unknown as { mediaInboxIds: string[]; date: string }).mediaInboxIds).toEqual(["p1", "p2", "p4"]);
    expect((commitBody as unknown as { date: string }).date).toBe("2025-11-05");
  });

  test("photographs with no date at all: it asks which day instead of using today", async () => {
    inbox = [A, B];
    await mount();
    await chooseEveryWaitingPhoto();
    expect(text()).toContain("Which day was this?");
    const save = Array.from(container.ownerDocument.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Save privately");
    expect(save?.disabled).toBe(true);
  });

  describe("B2193 — a hub day card opens the page with exactly that day's photographs", () => {
    const THREE_DAYS: Item[] = [
      { ...A, id: "d5a", filename: "d5a.jpg", takenAt: "2025-11-05T23:50:00" },
      { ...A, id: "d6a", filename: "d6a.jpg", takenAt: "2025-11-06T00:10:00", uploadedAt: "2025-11-10T10:00:02.000Z" },
      { ...A, id: "d6b", filename: "d6b.jpg", takenAt: "2025-11-06T12:00:00", uploadedAt: "2025-11-10T10:00:03.000Z" },
      { ...A, id: "d7a", filename: "d7a.jpg", takenAt: "2025-11-07T09:00:00", uploadedAt: "2025-11-10T10:00:04.000Z" },
      { ...A, id: "wa", filename: "wa.jpg", uploadedAt: "2025-11-10T10:00:05.000Z" },
    ];

    test("?photos=<date> chooses that day's photographs, over a stored draft's choice", async () => {
      inbox = THREE_DAYS;
      sessionStorage.setItem(addDayStorageKey("alex"), JSON.stringify({ savedAt: new Date().toISOString(), selectedIds: ["d7a"], photosInit: true, dateOverride: "2025-11-07" }));
      props = { initialPhotos: "2025-11-06" };
      await mount();
      expect(text()).toContain("2 chosen");
      expect(dateChip()).toContain("from 2 photos");
      expect(text()).not.toContain("different day");
      await click("Save privately");
      const body = commitBody as unknown as { mediaInboxIds: string[]; date: string };
      expect(body.mediaInboxIds).toEqual(["d6a", "d6b"]);
      expect(body.date).toBe("2025-11-06");
    });

    test("?photos=undated chooses only the photographs with no date, and asks the day", async () => {
      inbox = THREE_DAYS;
      props = { initialPhotos: "undated" };
      await mount();
      expect(text()).toContain("1 chosen");
      expect(text()).toContain("Which day was this?");
    });

    test("photographs from several days offer to make that many days, on the hub's cards", async () => {
      inbox = THREE_DAYS;
      await mount();
      await chooseEveryWaitingPhoto();
      const split = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "These are from 3 days — make 3 days");
      expect(split?.getAttribute("href")).toBe("/alex/studio#waiting");
    });
  });

  describe("B2232 — the grid holds only this day's photographs", () => {
    const at = (id: string, takenAt?: string): Item => ({ ...A, id, filename: `${id}.jpg`, takenAt });
    const TODAYS = [at("t1", `${TODAY}T08:00:00`), at("t2", `${TODAY}T12:00:00`), at("t3", `${TODAY}T18:00:00`)];
    const OTHERS = [at("o1", "2025-11-03T10:00:00"), at("o2", "2025-11-04T10:00:00"), at("o3", "2024-05-01T10:00:00"), at("o4"), at("o5")];
    const grid = () => Array.from(container.querySelectorAll("ul:not([data-waiting-photos] ul) [data-photo]"), (b) => b.getAttribute("data-photo"));
    const waiting = () => Array.from(container.querySelectorAll("[data-waiting-photos] [data-photo]"), (b) => b.getAttribute("data-photo"));

    test("3 photographs taken today and 5 others: only the 3, the rest behind 'Add more from what's waiting'", async () => {
      inbox = [...OTHERS, ...TODAYS];
      await mount();
      expect(grid()).toEqual(["t1.jpg", "t2.jpg", "t3.jpg"]);
      expect(text()).toContain("3 chosen");
      expect(text()).toContain("Add more from what's waiting (5)");
      expect(waiting()).toEqual(["o1.jpg", "o2.jpg", "o3.jpg", "o4.jpg", "o5.jpg"]);

      // Tapping one there adds it to the day, and the count says so.
      await act(async () => (container.querySelector('[data-waiting-photos] [data-photo="o4.jpg"]') as HTMLButtonElement).click());
      await flush();
      expect(grid()).toEqual(["o4.jpg", "t1.jpg", "t2.jpg", "t3.jpg"]);
      expect(text()).toContain("4 chosen");
      expect(text()).toContain("Add more from what's waiting (4)");
      await click("Save privately");
      expect((commitBody as unknown as { mediaInboxIds: string[] }).mediaInboxIds).toEqual(["o4", "t1", "t2", "t3"]);
    });

    test("from a card, the grid is that card's photographs; files brought in now join them", async () => {
      inbox = [...OTHERS, ...TODAYS];
      props = { initialPhotos: "2025-11-03" };
      await mount();
      expect(grid()).toEqual(["o1.jpg"]);
      expect(text()).toContain("1 chosen");
      expect(text()).toContain("Add more from what's waiting (7)");
      await pickTwoFiles();
      expect(grid()).toEqual(["o1.jpg", "01.jpg", "02.jpg"]);
      expect(text()).toContain("3 chosen");
    });
  });

  test("B2231 — two trips cover the date: the composer files the day into the shorter one", async () => {
    props = { trips: [...TRIPS, { id: "wochenende", title: "Wochenende", start: "2025-11-09", end: "2025-11-11" }] };
    await mount();
    expect(dateChip()).toContain("Wochenende · day 2");
    await click("Save privately");
    expect((commitBody as unknown as { trip: string }).trip).toBe("wochenende");
  });

  test("?trip= preselects that trip", async () => {
    props = { initialTripId: "andere" };
    await mount();
    expect(dateChip()).toContain("Eine andere Reise");
  });

  test("the date chip opens 'Not right? Change it' with the trip and the day, never a tiny ×", async () => {
    await mount();
    await act(async () => (container.querySelector('[data-chip="date"]') as HTMLButtonElement).click());
    expect(text()).toContain("Not right? Change it");
    const select = container.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["reise", "andere"]);
    expect(text()).not.toContain("×");
  });

  test("weather: a chip only with the capability and coordinates, on by default, removable", async () => {
    inbox = [{ ...A, takenAt: "2025-11-05T09:00:00", lat: 46.2, lon: 9.0 }];
    props = { initialPhotos: "2025-11-05" };
    await mount();
    expect(container.querySelector('[data-chip="weather"]')).toBeNull();
    await click("Save privately");
    expect((commitBody as unknown as { weather: boolean }).weather).toBe(false);

    act(() => root!.unmount());
    container.remove();
    sessionStorage.clear();
    props = { weatherAvailable: true, initialPhotos: "2025-11-05" };
    await mount();
    expect(container.querySelector('[data-chip="weather"]')?.textContent).toContain("looked up when you save");
    await act(async () => (container.querySelector('[data-chip="weather"]') as HTMLButtonElement).click());
    await click("Leave it out");
    expect(container.querySelector('[data-chip="weather"]')?.textContent).toContain("not looked up");
    await click("Save privately");
    expect((commitBody as unknown as { weather: boolean; lat: number }).weather).toBe(false);
    expect((commitBody as unknown as { lat: number }).lat).toBe(46.2);
  });

  test("with weather on, the write asks for the lookup", async () => {
    inbox = [{ ...A, takenAt: "2025-11-05T09:00:00", lat: 46.2, lon: 9.0 }];
    props = { weatherAvailable: true, initialPhotos: "2025-11-05" };
    await mount();
    await click("Save privately");
    expect((commitBody as unknown as { weather: boolean }).weather).toBe(true);
  });

  test("the saved sentence names the people on the trip, and sharing is a quiet link", async () => {
    props = { readersByTrip: { reise: ["Hans", "Viki"] } };
    await mount();
    await click("Save privately");
    expect(text()).toContain("Saved. Only you and Hans, Viki can see this day.");
    const share = [...container.querySelectorAll("a")].find((a) => a.textContent?.trim() === "Share this day ›");
    expect(share?.getAttribute("href")).toBe("/alex/studio/day/publish?day=a-day&trip=reise");
  });

  test("a date with a draft day offers to add to it, and a second entry with a time", async () => {
    dayNew = () =>
      commitBody?.confirmSecondEntry
        ? Response.json({ ok: true, slug: `${TODAY}-second` }, { status: 201 })
        : Response.json({ error: "date_has_day", existing: { slug: "first", title: "First", status: "draft" } }, { status: 409 });
    await mount();
    await click("Save privately");
    expect(text()).toContain("already has a day");
    expect([...container.querySelectorAll("a")].find((a) => a.textContent === "Add to that day instead")?.getAttribute("href")).toBe(
      "/alex/studio/day/edit?slug=first",
    );
    type(container.querySelector("input[type=time]") as HTMLInputElement, "18:00");
    await flush();
    await click("Make a second entry on this date");
    expect(commitBody).toMatchObject({ confirmSecondEntry: true, time: "18:00" });
    expect(text()).toContain("Saved.");
  });

  test("a date with a published day offers to change it, not to add to it", async () => {
    dayNew = () => Response.json({ error: "date_has_day", existing: { slug: "first", title: "First", status: "published" } }, { status: 409 });
    await mount();
    await click("Save privately");
    expect(text()).toContain("Change that day instead");
    expect(text()).not.toContain("Add to that day instead");
  });

  test("Polish my text sits under the box when the page hands it a balance, and is absent on null", async () => {
    const words = "We walked along the river all morning and then ate far too many pastries by the tower.";
    await mount();
    type(container.querySelector("textarea") as HTMLTextAreaElement, words);
    await flush();
    expect(text()).not.toContain("Polish my text");

    act(() => root!.unmount());
    container.remove();
    props = { polishCredits: 5 };
    await mount();
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(words);
    expect(text()).toContain("Polish my text");
  });

  test("More details is collapsed and remembered", async () => {
    await mount();
    const details = () => container.querySelector("details") as HTMLDetailsElement;
    expect(details().open).toBe(false);
    await act(async () => {
      details().open = true;
      details().dispatchEvent(new Event("toggle"));
    });
    await reload();
    expect(details().open).toBe(true);
  });
});

describe("AddDayFlow, first run — B2188 (C inside A)", () => {
  test("an owner with no day yet sees the same page one part at a time", async () => {
    props = { writtenDatesByTrip: { reise: [], andere: [] } };
    await mount();
    expect(text()).toContain("1 of 3");
    expect(container.querySelector("textarea")).toBeNull();
    await click("Next: a few words");
    expect(currentSearch()).toBe("step=words");
    expect(text()).toContain("2 of 3");
    expect(container.querySelector("input[type=file]")).toBeNull();
    type(container.querySelector("textarea") as HTMLTextAreaElement, "Our first day.");
    await flush();
    await click("Next: save it");
    expect(text()).toContain("3 of 3");
    await click("Save privately");
    expect((commitBody as unknown as { content: string }).content).toBe("Our first day.");
  });
});

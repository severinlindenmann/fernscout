// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2187 — "A new trip" is one screen: a name, two dates and who can read it
 * (already "Only you"), then "Create trip". Everything else is under "More
 * settings", collapsed. B2077's session draft still keeps typed work across
 * a reload, and done's "Add the first day" names the trip just made.
 * `next/navigation` is a stand-in with a real history stack.
 */

let history: string[] = [""];
const current = () => new URLSearchParams(history[history.length - 1]);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => history.push(href.split("?")[1] ?? ""),
    back: () => history.length > 1 && history.pop(),
    replace: vi.fn(),
  }),
  usePathname: () => "/alex/studio/trip/new",
  useSearchParams: () => current(),
}));

const { default: NewTripFlow } = await import("@/components/studio/trip/NewTripFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
let container: HTMLDivElement;

let existingTrips: { id: string; title: string; start: string; end: string; status: string }[] = [];
let extra: Record<string, unknown> = {};

function tree() {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <NewTripFlow
          username="alex"
          visibilities={["guest", "public", "private"]}
          accents={["sky"]}
          existingTrips={existingTrips}
          whatsappAvailable={false}
          otherLocales={[]}
          defaultLocale="en"
          baseCurrency="CHF"
          currencies={["CHF"]}
          contacts={[]}
          figures={[]}
          journalFigures={[]}
          {...extra}
        />
      </StudioBarProvider>
    </LocaleProvider>
  );
}
function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(tree()));
}
/** What a URL change does in the app router: the same tree, new params. */
const rerender = () => act(() => root!.render(tree()));
const reload = () => {
  act(() => root!.unmount());
  container.remove();
  mount();
};

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
const titleInput = () => container.querySelector("input[type=text]") as HTMLInputElement;

function fillStepOne() {
  const [start, end] = Array.from(container.querySelectorAll("[data-date-field] input")) as HTMLInputElement[];
  act(() => {
    type(titleInput(), "Round the Alps");
    type(start, "2026-05-10");
    type(end, "2026-05-15");
  });
}

beforeEach(() => {
  history = [""];
  existingTrips = [];
  extra = {};
  sessionStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

const created = () =>
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify({ ok: true, id: "round-the-alps-2026" }), { status: 200 }),
  );
const sent = (fetchMock: ReturnType<typeof created>) =>
  JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
const more = () => container.querySelector("[data-more-settings]") as HTMLDetailsElement;
async function create() {
  await act(async () => {
    button("Create trip").click();
  });
  rerender();
}
const doneLinks = () =>
  Array.from(container.querySelectorAll(".studio-done-card a"), (a) => [a.textContent, a.getAttribute("href")]);

describe("NewTripFlow — one screen, B2187", () => {
  test("one screen: no step counter, no check list; who can read it says 'Only you'; More settings is collapsed", () => {
    mount();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d of \d/);
    expect(container.querySelector("[data-decide-row]")).toBeNull();
    expect(text).toContain("What's the trip called?");
    expect(container.querySelector("[data-who-can-read] summary")?.textContent).toContain("Only you");
    expect(text).toContain("Nothing is shared until you share a day yourself.");
    expect(more()).not.toBeNull();
    expect(more().open).toBe(false);
    expect(button("Create trip").disabled).toBe(true);
  });

  test("B2238: the locked-card note follows the choice, not always the default", () => {
    mount();
    expect(container.textContent).toContain('"Show nothing" is chosen for you');
    act(() => button("Show a locked card").click());
    expect(container.textContent).toContain("A stranger who finds the link sees a locked card with the trip's title and dates, and nothing else.");
    expect(container.textContent).not.toContain('"Show nothing" is chosen for you');
    act(() => button("Show nothing").click());
    expect(container.textContent).toContain('"Show nothing" is chosen for you');
  });

  test("a trip is created from a title and two dates alone: private, the four helper fields 'none', no teaser", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    fillStepOne();
    expect(more().open).toBe(false);
    expect(button("Create trip").disabled).toBe(false);
    await create();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sent(fetchMock);
    expect(body).toMatchObject({
      title: "Round the Alps",
      start: "2026-05-10",
      end: "2026-05-15",
      // Private whatever order the journal's visibilities come in (this
      // tree hands them guest-first) — never the journal's own default.
      visibility: "private",
      accent: "none",
      tagline: "none",
      intro: "none",
      rates: "none",
    });
    // B2185 — "Show nothing" is the default and sends no field at all.
    expect("teaser" in body).toBe(false);
  });

  test("done on a private trip: one action, the first day of the trip just made; the draft is gone", async () => {
    vi.stubGlobal("fetch", created());
    mount();
    fillStepOne();
    await create();
    expect(doneLinks()).toEqual([["Add the first day", "/alex/studio/day/new?trip=round-the-alps-2026"]]);
    expect(sessionStorage.getItem("studio:newTrip:alex")).toBeNull();
  });

  test("done on a trip guests can read: the first day, then an invite that says it sends an email", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    fillStepOne();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-who-can-read] button")).find((b) => b.textContent?.startsWith("Guests"))!.click());
    expect(container.querySelector("[data-who-can-read] summary")?.textContent).toContain("You and the guests of this journal");
    await create();
    expect(sent(fetchMock).visibility).toBe("guest");
    expect(doneLinks()).toEqual([
      ["Add the first day", "/alex/studio/day/new?trip=round-the-alps-2026"],
      ["Invite someone (sends an email)", "/alex/studio/readers#invite"],
    ]);
  });

  test("More settings, once opened, still reaches the create: subtitle, colour and the locked card", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    fillStepOne();
    act(() => {
      more().open = true;
    });
    const tagline = container.querySelector('[data-more-settings] input[type=text]') as HTMLInputElement;
    act(() => type(tagline, "Too much cheese"));
    act(() => (container.querySelector('[data-more-settings] button[aria-label="sky"]') as HTMLButtonElement).click());
    act(() => button("Show a locked card").click());
    await create();
    expect(sent(fetchMock)).toMatchObject({
      title: "Round the Alps",
      tagline: "Too much cheese",
      accent: "sky",
      intro: "none",
      rates: "none",
      teaser: true,
    });
  });

  test("a reload keeps what was typed", () => {
    mount();
    fillStepOne();
    reload();
    expect(titleInput().value).toBe("Round the Alps");
  });

  test("B2136: an old deep link to ?step=decide lands on the one screen, with nothing to commit", () => {
    history = ["step=decide"];
    mount();
    expect(titleInput()).not.toBeNull();
    expect(button("Create trip").disabled).toBe(true);
  });

  test("T3!: dates that include today beside the current trip ask first, and 'That is fine' creates it", async () => {
    const today = new Date().toISOString().slice(0, 10);
    existingTrips = [{ id: "alps", title: "Alps", start: "2020-01-01", end: "2999-01-01", status: "current" }];
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    const [start, end] = Array.from(container.querySelectorAll("[data-date-field] input")) as HTMLInputElement[];
    act(() => {
      type(titleInput(), "Round the Alps");
      type(start, today);
      type(end, today);
    });
    await create();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Two trips now include today");
    await act(async () => {
      button("That is fine").click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("B2193 — a trip started from waiting photographs", () => {
  test("the dates are prefilled and counted, over a stored draft's; the name stays empty with a hint only", () => {
    sessionStorage.setItem("studio:newTrip:alex", JSON.stringify({ title: "", start: "", end: "" }));
    extra = { initialRange: { start: "2026-09-20", end: "2026-09-27", photos: 44 }, photoRun: { start: "2026-09-20", end: "2026-09-27" } };
    mount();
    const [start, end] = Array.from(container.querySelectorAll("[data-date-field] input")) as HTMLInputElement[];
    expect([start.value, end.value]).toEqual(["Sunday, 20 September", "Sunday, 27 September"]);
    expect(titleInput().value).toBe("");
    expect(titleInput().placeholder).not.toBe("");
    expect(container.querySelector("[data-from-photos]")?.textContent).toBe(
      "44 photos, taken 20 Sep – 27 Sep. The dates come from them; the name is yours to give.",
    );
    // Already showing that proposal: no link to itself.
    expect(container.textContent).not.toContain("Or start from my photos");
  });

  test("a blank form offers the photographs' own proposal as a quiet link", () => {
    extra = { photoRun: { start: "2026-09-20", end: "2026-09-27" } };
    mount();
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Or start from my photos");
    expect(link?.getAttribute("href")).toBe("/alex/studio/trip/new?start=2026-09-20&end=2026-09-27");
    expect(container.querySelector("[data-from-photos]")).toBeNull();
  });
});

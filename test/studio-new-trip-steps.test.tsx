// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2846 - "A new trip" is one screen: a name, one range calendar and who can
 * read it, then "Create trip". No "More settings": the create writes what the
 * old flow wrote with every optional step skipped. B2077's session draft still
 * keeps typed work across a reload; done has one primary, "Add the first day".
 * `next/navigation` is a stand-in with a real history stack.
 */

let history: string[] = [""];
const current = () => new URLSearchParams(history[history.length - 1]);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => history.push(href.split("?")[1] ?? ""),
    back: () => history.length > 1 && history.pop(),
    replace: vi.fn(),
    refresh: () => {},
  }),
  usePathname: () => "/@alex/studio/trip/new",
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
          defaultVisibility="private"
          guestCount={0}
          guestsHref="/@alex/studio/readers"
          existingTrips={existingTrips}
          otherLocales={[]}
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
  act(() => type(titleInput(), "Round the Alps"));
  // Two taps on the one grid: the first day, then the last (this month's grid).
  tap(`${thisMonth}-10`);
  tap(`${thisMonth}-15`);
}
const thisMonth = new Date().toISOString().slice(0, 7);
function tap(date: string) {
  act(() => (container.querySelector(`[data-date-field] button[data-date="${date}"]`) as HTMLButtonElement).click());
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
async function create() {
  await act(async () => {
    button("Create trip").click();
  });
  rerender();
}
const doneRows = () =>
  Array.from(container.querySelectorAll("ul a"), (a) => [a.textContent, a.getAttribute("href")]);

describe("NewTripFlow — one screen, B2846", () => {
  test("only the name, one calendar and who can read it; no More settings; Create waits for both", () => {
    mount();
    const text = container.textContent ?? "";
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelectorAll("[data-date-field] input")).toHaveLength(0);
    expect(container.querySelector("[data-more-settings]")).toBeNull();
    expect(text).toContain("What's the trip called?");
    expect(titleInput().placeholder).toBe("e.g. Greece in May");
    expect(container.querySelector("[data-who-can-read] summary")?.textContent).toContain("Only you");
    expect(container.querySelector("[data-range-summary]")?.textContent).toBe("Tap the first day, then the last.");
    expect(button("Create trip").disabled).toBe(true);
  });

  test("two taps pick a range and say it; a tap before the first day starts again", () => {
    mount();
    tap(`${thisMonth}-10`);
    expect(container.querySelector("[data-range-summary]")?.textContent).toContain("1 day");
    tap(`${thisMonth}-16`);
    expect(container.querySelector("[data-range-summary]")?.textContent).toMatch(/ – .* · 7 days$/);
    tap(`${thisMonth}-04`);
    expect(container.querySelector("[data-range-summary]")?.textContent).toContain("1 day");
  });

  test("I'm travelling now sets today as the first day", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    act(() => type(titleInput(), "Round the Alps"));
    act(() => button("I'm travelling now").click());
    await create();
    const today = new Date().toISOString().slice(0, 10);
    expect(sent(fetchMock)).toMatchObject({ start: today, end: today });
  });

  test("Create writes exactly what the old flow wrote with every optional step skipped", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    fillStepOne();
    expect(button("Create trip").disabled).toBe(false);
    await create();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Private whatever order the visibilities come in; "none" is the wire
    // sentinel for a field that was asked and not answered; no teaser field.
    expect(sent(fetchMock)).toEqual({
      title: "Round the Alps",
      start: `${thisMonth}-10`,
      end: `${thisMonth}-15`,
      visibility: "private",
      accent: "none",
      tagline: "none",
      intro: "none",
      rates: "none",
      costsBudget: "none",
      figuresMode: { mode: "journal" },
      company: "later",
    });
  });

  test("a journal with other languages also sends translations: none", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    extra = { otherLocales: ["de"] };
    mount();
    fillStepOne();
    await create();
    expect(sent(fetchMock).translations).toBe("none");
  });

  test("B2849: a journal not listed defaults to Invited guests with the guest count, no warning", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    extra = { defaultVisibility: "guest", guestCount: 3 };
    mount();
    fillStepOne();
    const card = container.querySelector("[data-who-can-read]")!;
    expect(card.textContent).toContain("Invited guests");
    expect(container.querySelector("[data-guest-count]")?.textContent).toContain("3 guests");
    expect(container.querySelector("[data-public-warning]")).toBeNull();
    await create();
    expect(sent(fetchMock).visibility).toBe("guest");
  });

  test("B2849: no guests yet reads so", () => {
    extra = { defaultVisibility: "guest", guestCount: 0 };
    mount();
    expect(container.querySelector("[data-guest-count]")?.textContent).toBe("No guests yet");
  });

  test("B2849: a listed journal defaults to Anybody with the public warning; choosing Anybody elsewhere shows it too", () => {
    extra = { defaultVisibility: "public" };
    mount();
    expect(container.querySelector("[data-public-warning]")?.textContent).toContain("Anyone with the link can read it");
    // The warning replaces the plain line; guest and private keep theirs.
    expect(container.textContent).not.toContain("Anybody can open the trip now");
    act(() => root!.unmount());
    container.remove();
    sessionStorage.clear();
    extra = { defaultVisibility: "guest" };
    mount();
    expect(container.querySelector("[data-public-warning]")).toBeNull();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-who-can-read] button")).find((b) => b.textContent?.startsWith("Public"))!.click());
    expect(container.querySelector("[data-public-warning]")).not.toBeNull();
  });

  test("done on a private trip: the first day is the one primary; photos and settings are quiet rows", async () => {
    vi.stubGlobal("fetch", created());
    mount();
    fillStepOne();
    await create();
    expect(button("Add the first day")).not.toBeNull();
    expect(doneRows()).toEqual([
      ["Bring in", "/@alex/studio/photos"],
      ["Open", "/@alex/studio/trip?trip=round-the-alps-2026"],
    ]);
    expect(sessionStorage.getItem("studio:newTrip:alex")).toBeNull();
  });

  test("done on a trip guests can read adds the read-along row, which says it sends an email", async () => {
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    fillStepOne();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-who-can-read] button")).find((b) => b.textContent?.startsWith("Invited guests"))!.click());
    await create();
    expect(sent(fetchMock).visibility).toBe("guest");
    expect(doneRows().at(-1)).toEqual(["Invite someone (sends an email)", "/@alex/studio/readers#invite"]);
  });

  test("a reload keeps what was typed, the days and who can read it too", () => {
    mount();
    fillStepOne();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-who-can-read] button")).find((b) => b.textContent?.startsWith("Public"))!.click());
    reload();
    expect(titleInput().value).toBe("Round the Alps");
    expect(container.querySelector("[data-range-summary]")?.textContent).toMatch(/ · 6 days$/);
    expect(container.querySelector("[data-who-can-read] summary")?.textContent).toContain("Anybody");
  });

  test("B2136: an old deep link to ?step=decide lands on the one screen, with nothing to commit", () => {
    history = ["step=decide"];
    mount();
    expect(titleInput()).not.toBeNull();
    expect(button("Create trip").disabled).toBe(true);
  });

  test("T3!: dates that include today beside the current trip say so in one line, and 'That is fine' creates it", async () => {
    existingTrips = [{ id: "alps", title: "Alps", start: "2020-01-01", end: "2999-01-01", status: "current" }];
    const fetchMock = created();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    act(() => type(titleInput(), "Round the Alps"));
    act(() => button("I'm travelling now").click());
    await create();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Two trips cover today. This newer one shows as current.");
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
    expect(container.querySelector("[data-range-summary]")?.textContent).toBe("20 Sep – 27 Sep · 8 days");
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
    expect(link?.getAttribute("href")).toBe("/@alex/studio/trip/new?start=2026-09-20&end=2026-09-27");
    expect(container.querySelector("[data-from-photos]")).toBeNull();
  });
});

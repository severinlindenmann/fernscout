// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";
import type { EditableDay } from "@/lib/studio/editDay";
import type { Entry } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));

/**
 * B2233 — costs, how you travelled and tags can be entered on the one-page
 * day ("More details") and in "Change a day", and each travels on that
 * page's own save. Blank stays blank; a started cost line must be whole.
 */

const { default: AddDayFlow } = await import("@/components/studio/day/AddDayFlow");
const { default: EditDayFlow } = await import("@/components/studio/day/EditDayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const { extrasToWrite, lineProblem, tagOf } = await import("@/components/studio/day/DayExtras");

let root: Root | undefined;
let container: HTMLDivElement;
let sent: Record<string, unknown> | null;

beforeEach(() => {
  sent = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/inbox")) return Response.json({ media: [] });
      if (url.includes("/day/new") || init?.method === "PATCH") {
        sent = JSON.parse(String(init?.body ?? "{}"));
        return Response.json({ ok: true, slug: "2025-11-10-a-day" }, { status: url.includes("/day/new") ? 201 : 200 });
      }
      return Response.json({ etag: '"abc"' });
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

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}
async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await flush();
}
function button(label: string | RegExp): HTMLButtonElement {
  const b = Array.from(container.ownerDocument.querySelectorAll("button")).find((x) =>
    typeof label === "string" ? x.textContent?.trim() === label : label.test(x.textContent?.trim() ?? ""),
  );
  if (!b) throw new Error(`no button ${label} in: ${container.textContent}`);
  return b;
}
async function click(label: string | RegExp) {
  await act(async () => button(label).click());
  await flush();
}
async function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  await act(async () => el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })));
  await flush();
}

/** One cost line, the train, and two tags — typed as a person would. */
async function fillExtras() {
  await click("Add a cost");
  const line = container.querySelector("[data-cost-line]")!;
  await type(line.querySelector('input[type="text"]')!, "Train to Lugano");
  await type(line.querySelector('input[type="number"]')!, "0");
  // A started line that is not whole says so under itself.
  expect(line.querySelector('[role="alert"]')?.textContent).toContain("amount above zero");
  await type(line.querySelector('input[type="number"]')!, "23.40");
  expect(line.querySelector('[role="alert"]')).toBeNull();
  await type(container.querySelector('select[name="transportMode"]')!, "train");
  const tag = container.querySelector<HTMLInputElement>("[data-day-extras] input:not([type=number])[id]")!;
  await type(tag, "Lake Side");
  await click("Add");
  await type(tag, "rain");
  await click("Add");
  expect(Array.from(container.querySelectorAll("[data-tag]"), (t) => t.getAttribute("data-tag"))).toEqual(["lake-side", "rain"]);
}

describe("the pieces", () => {
  test("a tag is the slug the day schema takes", () => {
    expect(tagOf("  Street Food! ")).toBe("street-food");
    expect(tagOf("---")).toBe("");
    expect(tagOf("x".repeat(40))).toHaveLength(30);
  });
  test("an untouched line is ignored, a started one must be whole", () => {
    expect(lineProblem({ label: "", amount: "", currency: "CHF" })).toBe(false);
    expect(lineProblem({ label: "Lunch", amount: "", currency: "CHF" })).toBe(true);
    expect(lineProblem({ label: "", amount: "5", currency: "CHF" })).toBe(true);
    expect(lineProblem({ label: "Lunch", amount: "5", currency: "CHF" })).toBe(false);
  });
  test("blank sends nothing — never an empty answer", () => {
    expect(extrasToWrite({ costs: [{ label: "", amount: "", currency: "CHF" }], transportMode: "", tags: [] })).toEqual({});
  });
});

describe("Add a day — More details (B2233)", () => {
  const TRIPS = [{ id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" }];
  const flow = (
    <AddDayFlow
      username="alex"
      trips={TRIPS}
      writtenDatesByTrip={{ reise: ["2025-11-02"] }}
      proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: "2025-11-10" }}
      currencies={["CHF", "EUR"]}
    />
  );

  test("costs, how you travelled and tags ride the one save; the currency is the journal's", async () => {
    await mount(flow);
    // Collapsed, the page has no dropdown.
    expect(container.querySelector("[data-day-extras]")).toBeNull();
    await act(async () => {
      const details = container.querySelector("details")!;
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await flush();
    expect(Array.from(container.querySelectorAll("[data-day-extras] select"), (s) => s.getAttribute("name"))).toContain("transportMode");
    await fillExtras();
    const currency = container.querySelector<HTMLSelectElement>("[data-cost-line] select")!;
    expect(Array.from(currency.options, (o) => o.value)).toEqual(["CHF", "EUR"]);
    await type(currency, "EUR");
    await click("Save privately");
    expect(sent!.costs).toEqual([{ label: "Train to Lugano", amount: 23.4, currency: "EUR" }]);
    expect(sent!.transportMode).toBe("train");
    expect(sent!.tags).toEqual(["lake-side", "rain"]);
    expect(sent!.declined).toEqual({});
  });

  test("nothing given, nothing sent", async () => {
    await mount(flow);
    await click("Save privately");
    expect(sent).not.toHaveProperty("costs");
    expect(sent).not.toHaveProperty("transportMode");
    expect(sent).not.toHaveProperty("tags");
  });
});

describe("Change a day (B2233)", () => {
  function editable(entry: Partial<Entry> = {}): EditableDay {
    const e = { slug: "a-day", date: "2025-11-01", title: "A day", gallery: [], tags: [], costs: [], content: "Words.", draft: true, ...entry } as unknown as Entry;
    return { tripId: "reise", tripTitle: "Reise", day: { date: e.date, entries: [e], lead: e }, currencies: ["CHF", "EUR"] };
  }

  test("a blank day takes all three, and Save sends them to the day's own door", async () => {
    await mount(<EditDayFlow username="alex" picker={[]} editable={editable()} />);
    await fillExtras();
    // On the studio bar the count is the review (B2073).
    await click(/^Save 3 changes$/);
    expect(sent).toEqual({
      costs: [{ label: "Train to Lugano", amount: 23.4, currency: "CHF" }],
      transportMode: "train",
      tags: ["lake-side", "rain"],
    });
  });

  test("what the day already carries is shown, sent back only when it moved, and cannot be emptied here", async () => {
    await mount(
      <EditDayFlow
        username="alex"
        picker={[]}
        editable={editable({
          costs: [{ label: "Hotel", amount: 120, currency: "USD", category: "accommodation" }],
          transport: { mode: "car", from: "", to: "" },
          tags: ["road"],
        } as Partial<Entry>)}
      />,
    );
    const line = container.querySelector("[data-cost-line]")!;
    expect((line.querySelector('input[type="text"]') as HTMLInputElement).value).toBe("Hotel");
    // A stored currency the journal does not list is still offered.
    expect(Array.from(line.querySelector("select")!.options, (o) => o.value)).toEqual(["CHF", "EUR", "USD"]);
    expect(line.querySelector("select")!.value).toBe("USD");
    expect(container.querySelector<HTMLSelectElement>('select[name="transportMode"]')!.value).toBe("car");
    expect(Array.from(container.querySelectorAll<HTMLOptionElement>('select[name="transportMode"] option'), (o) => o.value)).not.toContain("");
    expect(container.textContent).not.toContain("Remove this cost");
    expect(container.querySelector('[data-tag="road"] button')).toBeNull();

    await type(container.querySelector('select[name="transportMode"]')!, "bus");
    await click(/^Save 1 change$/);
    expect(sent).toEqual({ transportMode: "bus" });
  });
});

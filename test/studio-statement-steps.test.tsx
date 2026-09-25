// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2079, B2083 — "A bank statement" on `useStep`: an indicator from step 1,
 * a mapping screen that shows sample values and preselects its guess (the
 * currency included), a primary that only offers to read again once it can,
 * a check step that shows every line's date, Back and a reload that keep the
 * categories, and a done screen that says "1 cost". `next/navigation` is a
 * stand-in with a real history stack; the routes are stubbed fetches in the
 * shape `statement/apply` answers.
 */

let history: string[] = [""];
const current = () => new URLSearchParams(history[history.length - 1]);
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => history.push(href.split("?")[1] ?? ""),
    back: () => history.length > 1 && history.pop(),
    replace: (href: string) => (history[history.length - 1] = href.split("?")[1] ?? ""),
  }),
  usePathname: () => "/alex/studio/statement",
  useSearchParams: () => current(),
}));

const { default: StatementFlow } = await import("@/components/studio/statement/StatementFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

const HEADER = ["Booking date", "Value date", "Text", "Turnover", "Cur.", "Account"];
const SAMPLE = [
  ["04.03.2026", "05.03.2026", "Kiosk am Hafen", "12,40", "EUR", "Everyday"],
  ["05.03.2026", "06.03.2026", "Pension Seeblick", "74,00", "EUR", "Everyday"],
  ["06.03.2026", "07.03.2026", "Bäckerei", "4,20", "EUR", "Everyday"],
  ["07.03.2026", "08.03.2026", "Tankstelle", "52,10", "EUR", "Everyday"],
];

let root: Root | undefined;
let container: HTMLDivElement;
let bodies: Record<string, unknown>[] = [];
// B2130 — the trip's own costs.visibility, which the done screen's sentence follows.
let costsPublic = false;

function tree() {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <StudioBarProvider username="alex">
        <StatementFlow
          username="alex"
          trips={[{ id: "coast", title: "The coast", costsPublic }]}
          defaultTripId="coast"
          currencies={["CHF", "EUR"]}
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
const rerender = () => act(() => root!.render(tree()));
const reload = () => {
  act(() => root!.unmount());
  container.remove();
  mount();
};
function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}
const click = (text: string) => {
  act(() => button(text).click());
  rerender();
};
async function clickAsync(text: string) {
  await act(async () => {
    button(text).click();
  });
  await act(async () => {});
  rerender();
}
const selects = () => Array.from(container.querySelectorAll("select"));
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  rerender();
}

beforeEach(() => {
  history = [""];
  bodies = [];
  costsPublic = false;
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/inbox")) {
        return new Response(JSON.stringify({ ok: true, items: [{ id: "s1", filename: "export.csv" }] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.rows) {
        return new Response(
          JSON.stringify({
            ok: true,
            written: { written: [{ date: "2026-03-04", slug: "kiosk", added: 1, kept: 0 }], filedToTrip: [], total: 1 },
            filedToTrip: 0,
          }),
          { status: 200 },
        );
      }
      if (body.mapping) {
        return new Response(
          JSON.stringify({
            ok: true,
            read: 1,
            outside: 0,
            wrongSign: 0,
            spending: [{ date: "2026-03-04", label: "Kiosk am Hafen", amount: 12.4, currency: "EUR" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, unrecognized: true, header: HEADER, sample: SAMPLE }), { status: 200 });
    }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function toMapping() {
  mount();
  expect(container.textContent).toContain("1 of 5");
  click("Bring in a statement");
  expect(container.textContent).toContain("2 of 5");
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["x"], "export.csv")], configurable: true });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  rerender();
  await clickAsync("Read the file");
}

describe("StatementFlow on useStep — B2079, B2083", () => {
  test("the mapping screen preselects its guess, currency included, with three sample values under each choice", async () => {
    await toMapping();
    expect(current().get("step")).toBe("read");
    expect(container.textContent).toContain("3 of 5");
    const [date, what, amount, currency] = selects();
    expect([date.value, what.value, amount.value, currency.value]).toEqual(["Booking date", "Text", "Turnover", "Cur."]);
    expect(container.textContent).toContain("04.03.2026 · 05.03.2026 · 06.03.2026");
    expect(container.textContent).toContain("EUR · EUR · EUR");
    expect(container.textContent).not.toContain("Tankstelle");
    expect(button("That is right — read it again").disabled).toBe(false);

    choose(date, "");
    expect(button("Choose the date, what and amount first").disabled).toBe(true);
  });

  test("the check step shows each line's date; Back and a reload keep the category; done says 1 cost", async () => {
    await toMapping();
    await clickAsync("That is right — read it again");
    expect(bodies.at(-1)).toMatchObject({ mapping: { date: "Booking date", currency: "Cur.", decimalComma: true } });
    expect(container.textContent).toContain("1 line");

    click("Sort them out");
    expect(container.textContent).toContain("4 of 5");
    choose(selects()[0], "food");
    click("Check them before filing");
    expect(current().get("step")).toBe("decide");
    expect(container.textContent).toContain("5 of 5");
    expect(container.textContent).toContain("4 Mar · Kiosk am Hafen");
    expect(container.textContent).not.toContain("2026-03-04");
    // B2093 — every row of the check list is read by a person: no raw ISO date.
    const decideRows = Array.from(container.querySelectorAll("[data-decide-row]"), (li) => li.textContent ?? "");
    expect(decideRows.length).toBeGreaterThan(0);
    expect(decideRows.filter((row) => /\d{4}-\d{2}-\d{2}/.test(row))).toEqual([]);

    history.pop();
    rerender();
    expect(selects()[0].value).toBe("food");
    reload();
    expect(container.textContent).toContain("4 of 5");
    expect(selects()[0].value).toBe("food");

    click("Check them before filing");
    await clickAsync("File 1 cost to The coast");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("1 cost filed to The coast.");
    expect(container.textContent).toContain("1 cost landed");
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "See the trip's costs");
    expect(link?.getAttribute("href")).toBe("/alex/trips/coast/costs");
    // B2130 — guests-only costs: the public never sees them.
    expect(container.textContent).toContain("The public never sees these costs");
    expect(container.textContent).not.toContain("Anyone who can read this trip sees these costs.");
    expect(current().get("step")).toBeNull();
    expect(sessionStorage.getItem("studio:statement:alex")).toBeNull();
  });

  test("B2130 — on a trip whose costs are public, done says readers see them", async () => {
    costsPublic = true;
    await toMapping();
    await clickAsync("That is right — read it again");
    click("Sort them out");
    choose(selects()[0], "food");
    click("Check them before filing");
    await clickAsync("File 1 cost to The coast");
    expect(container.textContent).toContain("Anyone who can read this trip sees these costs.");
    expect(container.textContent).not.toContain("never sees");
  });
});

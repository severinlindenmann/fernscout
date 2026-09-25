// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import JournalPageContent, { type JournalPanel, type ReminderRow } from "@/app/[user]/studio/journal/JournalPageContent";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * B2074 — journal settings had two identical "Save" buttons 1,300px apart,
 * each saving only its own half, so the wrong one dropped the edit. One
 * Save now, in the bar, counting what moved; one press writes every field
 * that moved, top of the page and bottom alike.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const journal: JournalPanel = {
  title: "Fernscout Demo",
  tagline: "Five journeys",
  email: "owner@example.test",
  visibility: "public",
  units: "metric",
  locales: ["en", "de"],
  defaultLocale: "en",
  displayCurrencies: ["CHF", "EUR"],
  ownerTel: "",
  baseCurrency: "CHF",
};

async function mount(reminders: ReminderRow[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">
          <JournalPageContent username="alex" journal={journal} knownCurrencies={["EUR", "GBP", "USD"]} reminders={reminders} />
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
}

const form = () => container!.querySelector("[data-journal-settings]")!;
/** Every save control in the document — the form's own and the studio bar's. */
const saveButtons = () => Array.from(container!.querySelectorAll("button")).filter((b) => /save/i.test(b.textContent ?? ""));
const inputByValue = (value: string) =>
  Array.from(form().querySelectorAll("input")).find((i) => i.value === value) as HTMLInputElement;

function typeInto(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("journal settings — B2074", () => {
  test("exactly one save control, disabled until something changes", async () => {
    await mount();
    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].disabled).toBe(true);
    await act(async () => typeInto(inputByValue("Five journeys"), "Six journeys"));
    expect(saveButtons()[0].disabled).toBe(false);
    expect(saveButtons()[0].textContent).toBe("Save 1 change");
  });

  test("the name at the top and the currencies at the bottom save in one press", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }),
    );
    await mount();
    await act(async () => typeInto(inputByValue("Fernscout Demo"), "Fernscout Demo, again"));
    // B2143 — a chip from the rates table, not a typed list.
    const usd = [...form().querySelectorAll("[data-currency-picker] label")].find((l) => l.textContent === "USD")!;
    await act(async () => (usd.querySelector("input") as HTMLInputElement).click());
    expect(saveButtons()[0].textContent).toBe("Save 2 changes");
    await act(async () => saveButtons()[0].click());
    expect(bodies).toEqual([{ title: "Fernscout Demo, again", displayCurrencies: ["CHF", "EUR", "USD"] }]);
  });

  test("advertising is a labelled switch that rides the same Save", async () => {
    await mount();
    const toggle = form().querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(form().textContent).toContain("Listed on this server");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(saveButtons()[0].textContent).toBe("Save 1 change");
  });

  test("an emptied name is refused under the field", async () => {
    await mount();
    await act(async () => typeInto(inputByValue("Fernscout Demo"), ""));
    expect(form().querySelector('[role="alert"]')?.textContent).toBe("A name is needed to save.");
    expect(saveButtons()[0].disabled).toBe(true);
  });
});

/**
 * B2171 — the evening reminder's on/off, moved out of the retired chat room:
 * one switch per trip not yet over, riding the same Save, each trip that
 * moved written to its own reminder door and nothing else.
 */
describe("the evening reminder switch — B2171", () => {
  test("a trip's switch rides the one Save and writes only that trip's reminder", async () => {
    const calls: { url: string; method?: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
        return new Response("{}", { status: 200 });
      }),
    );
    await mount([
      { id: "japan", title: "Japan", on: false },
      { id: "peru", title: "Peru", on: true },
    ]);
    const section = form().querySelector("[data-journal-reminders]")!;
    const switches = [...section.querySelectorAll('[role="switch"]')] as HTMLButtonElement[];
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(section.textContent).toContain("Evening reminder");
    await act(async () => switches[0].click());
    expect(saveButtons()[0].textContent).toBe("Save 1 change");
    await act(async () => saveButtons()[0].click());
    expect(calls).toEqual([{ url: "/api/web/alex/trips/japan/reminder", method: "PATCH", body: { enabled: true } }]);
  });

  test("no trip still to come says so instead of drawing an empty list", async () => {
    await mount([]);
    const section = form().querySelector("[data-journal-reminders]")!;
    expect(section.querySelector('[role="switch"]')).toBeNull();
    expect(section.textContent).toContain("No trip is running or coming up");
  });
});

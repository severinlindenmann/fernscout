// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import JournalPageContent, { type JournalPanel } from "@/app/[user]/studio/journal/JournalPageContent";
import MoneyPanel from "@/components/studio/plan/MoneyPanel";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { clearConfigCache } from "@/lib/config";
import { dictionaryFor } from "@/lib/locales";
import { clearRatesCache, journalCurrencies, knownCurrencies } from "@/lib/rates";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

/**
 * B2143 — currencies were free text everywhere. The journal now picks its
 * list from the instance's rates table, and every studio currency choice
 * offers only that list, base first.
 */

const FIXTURES = path.join(process.cwd(), "test", "fixtures", "currency");
let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  process.env.CONTENT_DIR = FIXTURES;
  clearConfigCache();
  clearRatesCache();
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearRatesCache();
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">{node}</StudioBarProvider>
      </LocaleProvider>,
    ),
  );
}

describe("the helpers", () => {
  test("knownCurrencies is the rates table's codes plus EUR, and nothing else", () => {
    expect(knownCurrencies()).toEqual(["CHF", "EUR", "THB", "USD"]);
  });

  test("journalCurrencies is the journal's own list, base first", () => {
    expect(journalCurrencies("u")[0]).toBe("CHF");
    expect(journalCurrencies("u")).toEqual(["CHF", "EUR", "USD", "VND", "XXQ"]);
  });

  test("feeds the new trip, the planner's cost line and the statement mapping", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    expect(read("lib/studio/newTrip.ts")).toMatch(/currencies: journalCurrencies\(username\)/);
    expect(read("app/[user]/studio/plan/[trip]/page.tsx")).toMatch(/currencies=\{journalCurrencies\(user\)\}/);
    expect(read("app/[user]/studio/statement/page.tsx")).toMatch(/currencies=\{journalCurrencies\(user\)\}/);
    // And none of the three still takes a typed code.
    for (const file of [
      "components/studio/trip/NewTripFlow.tsx",
      "components/studio/plan/Composer.tsx",
      "components/studio/plan/MoneyPanel.tsx",
      "components/studio/statement/StatementFlow.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/toUpperCase\(\)\.slice\(0, 3\)|setFixedCurrency\(e\.target\.value\.toUpperCase\(\)\)/);
    }
  });

  test("the planner's cost line offers only the journal's list, base first", async () => {
    await mount(
      <MoneyPanel
        costs={{}}
        route={[]}
        baseCurrency="CHF"
        currencies={["CHF", "EUR", "THB"]}
        onSave={() => {}}
        onBack={() => {}}
        saveStatus="idle"
      />,
    );
    const select = container!.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["CHF", "EUR", "THB"]);
    expect(select.value).toBe("CHF");
  });
});

describe("the journal settings' currency picker", () => {
  const journal: JournalPanel = {
    title: "Fernscout Demo",
    tagline: "",
    email: "owner@example.test",
    visibility: "guest",
    units: "metric",
    locales: ["en"],
    defaultLocale: "en",
    displayCurrencies: ["CHF", "EUR"],
    ownerTel: "",
    baseCurrency: "CHF",
  };
  const chips = () =>
    [...container!.querySelectorAll("[data-currency-picker] label")].map((l) => l.textContent!.replace("✓", ""));

  test("offers only known codes, base pinned first and not removable, no free text", async () => {
    await mount(<JournalPageContent username="alex" journal={journal} knownCurrencies={["EUR", "GBP", "USD"]} reminders={[]} />);
    expect(chips()).toEqual(["CHF", "EUR", "GBP", "USD"]);
    const base = container!.querySelector("[data-currency-picker] input[type=checkbox]") as HTMLInputElement;
    expect(base.checked).toBe(true);
    expect(base.disabled).toBe(true);
    expect(container!.querySelector('[data-currency-picker] input[type="text"]')).toBeNull();
  });

  test("search narrows the chips but keeps the base", async () => {
    await mount(<JournalPageContent username="alex" journal={journal} knownCurrencies={["EUR", "GBP", "USD"]} reminders={[]} />);
    const search = container!.querySelector('[data-currency-picker] input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "pound");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(chips()).toEqual(["CHF", "GBP"]);
  });
});

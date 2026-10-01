// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2648 — "Getting there" offers what the owner's recorded route says, as
 * chips: nothing is filled in until one is tapped, and where the phone says
 * "car" it asks car, train or bus.
 */

const { default: DayExtras, NO_EXTRAS } = await import("@/components/studio/day/DayExtras");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");
const dict = dictionaryFor("en");

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

test("route modes are offered, not filled; car asks car, train or bus", async () => {
  function Harness() {
    const [value, setValue] = useState(NO_EXTRAS);
    return (
      <LocaleProvider dictionary={dict} locale="en">
        <DayExtras value={value} onChange={setValue} currencies={["CHF"]} routeTravel={[{ mode: "car", km: 84 }, { mode: "bike", km: 12 }]} />
      </LocaleProvider>
    );
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  const select = () => container.querySelector("select[name=transportMode]") as HTMLSelectElement;
  const chip = (label: string) => Array.from(container.querySelectorAll("[data-route-travel] button")).find((b) => b.textContent === label) as HTMLButtonElement;

  expect(select().value).toBe("");
  expect(container.querySelector("[data-route-travel]")!.textContent).toContain("84 km by car, train or bus?");
  expect(chip(dict["studio.day.transport.bicycle"])).toBeTruthy();
  expect(chip(dict["studio.day.transport.train"])).toBeTruthy();

  await act(async () => chip(dict["studio.day.transport.train"]).click());
  expect(select().value).toBe("train");
  expect(chip(dict["studio.day.transport.train"]).getAttribute("aria-pressed")).toBe("true");
});

// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DateField, { type TripCalendar } from "@/components/studio/DateField";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { numericDate, parseTypedDate } from "@/lib/studio/monthGrid";

/**
 * B2167 — the studio's own date field replaces the browser's. It must read
 * what a person types in their own form, keep the last good date when it
 * cannot, draw the trip it knows about, and pick a range in two taps.
 */

let root: Root | undefined;
let container: HTMLDivElement;
let seen: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20, 12));
  seen = [];
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

function Single({ initial, calendar }: { initial: string; calendar?: TripCalendar }) {
  const [value, setValue] = useState(initial);
  return <DateField label="Date" value={value} onChange={(d) => { seen.push(d); setValue(d); }} {...calendar} />;
}

function Range() {
  const [range, setRange] = useState({ start: "", end: "" });
  return (
    <>
      <output data-range>{`${range.start}..${range.end}`}</output>
      <DateField range={{ ...range, onChange: (start, end) => setRange({ start, end }), startLabel: "First day", endLabel: "Last day" }} />
    </>
  );
}

function mount(node: React.ReactNode, locale: "en" | "de" | "hu" = "en") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<LocaleProvider dictionary={dictionaryFor(locale)} locale={locale}>{node}</LocaleProvider>));
}

function type(el: HTMLInputElement, value: string) {
  act(() => el.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => el.blur());
}
const field = () => container.querySelector("[data-date-field] input") as HTMLInputElement;
const day = (date: string) => container.querySelector(`button[data-date="${date}"]`) as HTMLButtonElement;

describe("typing", () => {
  test("the locale's own form and ISO both set the value", () => {
    mount(<Single initial="2026-09-01" />, "de");
    expect(field().value).toBe("Dienstag, 1. September");
    type(field(), "24.09.2026");
    expect(seen.at(-1)).toBe("2026-09-24");
    expect(field().value).toBe("Donnerstag, 24. September");
    type(field(), "2026-10-03");
    expect(seen.at(-1)).toBe("2026-10-03");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test("an unreadable date keeps the last value and says so", () => {
    mount(<Single initial="2026-09-01" />);
    type(field(), "31/02/2026");
    expect(seen).toEqual([]);
    expect(field().value).toBe("Tuesday, 1 September");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("DD/MM/YYYY");
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  test("parse and format round-trip per locale; impossible days are refused", () => {
    for (const locale of ["en", "de", "hu"]) expect(parseTypedDate(numericDate("2026-09-24", locale))).toBe("2026-09-24");
    expect(numericDate("2026-09-24", "hu")).toBe("2026.09.24.");
    for (const bad of ["31.02.2026", "24.09.26", "2026-13-01", "yesterday", "24 09 2026"]) expect(parseTypedDate(bad)).toBeNull();
  });
});

describe("the trip on the grid", () => {
  const calendar = { tripStart: "2026-09-12", tripEnd: "2026-09-27", writtenDates: ["2026-09-13", "2026-09-14"], draftDates: ["2026-09-21"] };

  test("the band covers exactly the trip, dots mark told and draft days, today is current", () => {
    mount(<Single initial="2026-09-24" calendar={calendar} />);
    const banded = [...container.querySelectorAll("[data-band]")].map((b) => (b.parentElement!.querySelector("button") as HTMLButtonElement).dataset.date);
    expect(banded[0]).toBe("2026-09-12");
    expect(banded.at(-1)).toBe("2026-09-27");
    expect(banded).toHaveLength(16);
    expect(day("2026-09-13").querySelector("[data-dot]")?.getAttribute("data-dot")).toBe("written");
    expect(day("2026-09-21").querySelector("[data-dot]")?.getAttribute("data-dot")).toBe("draft");
    expect(day("2026-09-16").querySelector("[data-dot]")).toBeNull();
    expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    expect(day("2026-09-20").getAttribute("aria-current")).toBe("date");
    expect(day("2026-09-24").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-30").disabled).toBe(false);
  });

  test("the day of the trip sits beside the date, in each language", () => {
    mount(<Single initial="2026-09-24" calendar={calendar} />);
    expect(container.textContent).toContain("Day 13");
    act(() => root!.unmount());
    container.remove();
    mount(<Single initial="2026-09-24" calendar={calendar} />, "hu");
    expect(container.textContent).toContain("13. nap");
  });

  test("Today picks today", () => {
    mount(<Single initial="2026-08-01" />);
    const today = [...container.querySelectorAll("button")].find((b) => b.textContent === "Today")!;
    act(() => today.click());
    expect(seen).toEqual(["2026-09-20"]);
  });
});

describe("range mode", () => {
  test("first tap is the first day, second the last; a tap before the first restarts", () => {
    mount(<Range />);
    const range = () => container.querySelector("[data-range]")!.textContent;
    act(() => day("2026-09-12").click());
    expect(range()).toBe("2026-09-12..2026-09-12");
    act(() => day("2026-09-27").click());
    expect(range()).toBe("2026-09-12..2026-09-27");
    expect(container.querySelectorAll("[data-band]")).toHaveLength(16);
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(2);
    // A new range starts on the next tap…
    act(() => day("2026-09-15").click());
    expect(range()).toBe("2026-09-15..2026-09-15");
    // …and a tap before its first day starts it again from there.
    act(() => day("2026-09-10").click());
    expect(range()).toBe("2026-09-10..2026-09-10");
    act(() => day("2026-09-18").click());
    expect(range()).toBe("2026-09-10..2026-09-18");
  });
});

describe("every studio date field is this one", () => {
  const files: Record<string, string> = {
    "components/EditDay.tsx": "<DateField",
    "components/DayCosts.tsx": "<DateField",
    "components/studio/trip/NewTripFlow.tsx": "<DateField",
    "components/studio/trip/TripEditFlow.tsx": "<DateField",
    "components/studio/day/ReshapeDayFlow.tsx": "<DateField",
    "components/studio/day/AddDayFlow.tsx": "<MonthGrid",
  };
  for (const [file, marker] of Object.entries(files)) {
    test(file, () => {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain(marker);
      expect(source).not.toMatch(/type=["{]+date/);
    });
  }
});

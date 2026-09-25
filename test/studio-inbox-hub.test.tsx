// @vitest-environment jsdom
//
// B2084 — the studio inbox's own screen: a preview per file, a move sheet
// that names the file it moves and highlights no day until one is chosen,
// and a status line that says where the file went.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import InboxHub from "@/components/studio/inbox/InboxHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { InboxHubModel, InboxRow } from "@/lib/studio/inbox";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/ana/studio/inbox" }));

const CSV: InboxRow = {
  id: "d1e256f760d4-statement.csv",
  kind: "files",
  day: null,
  name: "statement.csv",
  bytes: 181,
  type: "statement",
  uploadedAt: "2026-09-20T10:00:00Z",
  preview: {
    kind: "table",
    rows: [
      ["Date", "Description", "Amount"],
      ["2026-08-01", "Bakery Zermatt", "-7.40"],
    ],
  },
};

const MODEL: InboxHubModel = {
  waiting: [CSV],
  days: [],
  dayBounds: { start: "2026-09-01", end: "2026-09-23" },
  writtenDates: [],
  entriesByDate: {},
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(model: InboxHubModel = MODEL) {
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <StudioBarProvider username="ana">
          <InboxHub username="ana" model={model} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function button(text: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!el) throw new Error(`no button "${text}"`);
  return el;
}

describe("the studio inbox", () => {
  test("a CSV tile opens a preview with its first rows", () => {
    mount();
    expect(container.querySelector("table")).toBeNull();
    click(button("Preview"));
    const cells = Array.from(container.querySelectorAll("table th, table td")).map((c) => c.textContent);
    expect(cells).toEqual(["Date", "Description", "Amount", "2026-08-01", "Bakery Zermatt", "-7.40"]);
  });

  test("Move and Delete are words, not only icons", () => {
    mount();
    expect(button("Move")).toBeTruthy();
    expect(button("Delete")).toBeTruthy();
  });

  test("the move sheet names the file and highlights no day until one is chosen", async () => {
    mount();
    click(button("Move"));
    expect(container.textContent).toContain("Which day is statement.csv from?");

    const days = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).filter((b) =>
      b.getAttribute("aria-label")?.includes("September"),
    );
    expect(days.length).toBeGreaterThan(0);
    expect(days.filter((b) => b.getAttribute("aria-pressed") === "true")).toEqual([]);
    // Never a highlighted day whose button cannot be pressed.
    expect(days.some((b) => b.disabled && b.getAttribute("aria-pressed") === "true")).toBe(false);

    const day = days.find((b) => b.getAttribute("aria-label") === "Tuesday, 22 September")!;
    click(day);
    // B2138 — a move to a date pins the file to it; it says so.
    const confirm = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Pin to"))!;
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(
      /^statement\.csv is pinned to .+ — not on the day itself yet\.$/,
    );
  });
});

const photo = (id: string, day: string | null = null): InboxRow => ({
  id,
  kind: "media",
  day,
  name: id,
  bytes: 1024 * 1024,
  type: "photo",
  uploadedAt: "2026-09-20T10:00:00Z",
});
const GPX: InboxRow = { ...CSV, id: "t.json", name: "timeline.json", bytes: 2 * 1024 * 1024, type: "location", preview: { kind: "location", format: null } };

function buttonsStarting(text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim().startsWith(text));
}
const fetchCalls = () => (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;

describe("B2138 — the inbox move says what happened; select all; bulk delete", () => {
  test("with two trips' days on the chosen date the move asks which, then puts the photograph on it for real", async () => {
    mount({
      ...MODEL,
      waiting: [photo("02.jpg")],
      entriesByDate: {
        "2026-09-22": [
          { tripId: "alps", tripTitle: "Alps", slug: "2026-09-22-lake", title: "The lake", published: false },
          { tripId: "work", tripTitle: "Work", slug: "2026-09-22-office", title: "Office", published: true },
        ],
      },
    });
    click(button("Move"));
    click(container.querySelector('button[aria-label="Tuesday, 22 September"]')!);
    expect(container.textContent).toContain("That date already has a day written. Put it on:");
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="inbox-onto"]'));
    expect(radios.some((r) => r.checked)).toBe(false);
    const confirm = () => buttonsStarting("Pin to").concat(buttonsStarting("Put onto"))[0];
    expect(confirm().disabled).toBe(true);
    const office = Array.from(container.querySelectorAll("label")).find((l) => l.textContent === "Work · Office")!;
    click(office.querySelector("input")!);
    expect(confirm().textContent).toBe("Put onto “Office”");
    expect(container.textContent).toContain("That day is on the site");
    await act(async () => {
      confirm().click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const attach = fetchCalls().find(([url]) => url.endsWith("/day/attach"))!;
    expect(JSON.parse(String(attach[1]!.body))).toEqual({ trip: "work", slug: "2026-09-22-office", files: ["02.jpg"] });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("02.jpg is on “Office” now.");
    expect(container.textContent).not.toContain("Waiting for a day");
  });

  test("Select all selects exactly the rows the active filter shows", () => {
    mount({ ...MODEL, waiting: [CSV, photo("a.jpg"), photo("b.jpg")] });
    click(button("Photographs"));
    click(button("Select all 2"));
    expect(container.textContent).toContain("2 selected");
    click(button("All"));
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.filter((b) => b.checked)).toHaveLength(2);
  });

  test("bulk delete asks once with the count and size, location exports included, then deletes exactly those", async () => {
    mount({ ...MODEL, waiting: [photo("a.jpg"), photo("b.jpg"), GPX] });
    click(button("Select all 3"));
    expect(buttonsStarting("Move to a day")).toHaveLength(1);
    click(button("Delete selected"));
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Delete 3 files (4 MB)? They are not on any day. This cannot be undone.",
    );
    expect(fetchCalls().filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    await act(async () => {
      buttonsStarting("Delete 3 files")[0].click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    const deleted = fetchCalls().filter(([, init]) => init?.method === "DELETE").map(([url]) => url.split("/inbox/")[1]);
    expect(deleted).toEqual(["a.jpg", "b.jpg", "t.json"]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("3 files deleted.");
    expect(container.textContent).toContain("Nothing is waiting.");
  });
});

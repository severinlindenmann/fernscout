// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DeleteTrip from "@/components/DeleteTrip";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/deletions", () => ({
  summarise: vi.fn().mockReturnValue({ title: "Empty trip", days: 0, files: 1, bytes: 10 }),
  deleteTrip: vi.fn(),
  humanBytes: vi.fn().mockReturnValue("10 B"),
}));

/**
 * B2052 — every trip delete asks first, an empty trip included.
 *
 * `DeleteTrip` used to delete on the first press when the inventory came back
 * `{ days: 0, files: 1 }`; a tester pressing the link to see what deleting
 * involves lost the trip. The question now always renders, in the coral
 * destructive tone, and only its confirm button sends the POST.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string; method: string }[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  calls = [];
});

function inventory(days: number, files: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const body =
        method === "GET"
          ? { title: "Empty trip", days, files, size: "1 KB" }
          : { redirect: "/alex/studio" };
      return { ok: true, json: async () => body } as Response;
    }),
  );
}

async function pressDelete() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <DeleteTrip username="alex" tripId="empty" />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    (container!.querySelector("button") as HTMLButtonElement).click();
  });
}

function confirmButton(): HTMLButtonElement {
  const dialog = container!.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!.querySelector("button") as HTMLButtonElement;
}

describe("B2052 — DeleteTrip always asks", () => {
  test("an empty trip ({days:0, files:1}) renders the ConfirmPanel and sends no delete before confirm", async () => {
    inventory(0, 1);
    await pressDelete();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    const question = container!.querySelector('[role="dialog"] p')!.textContent ?? "";
    expect(question).toContain("0 days and 1 file (");
    expect(confirmButton().className).toContain("bg-coral-600");
    expect(confirmButton().className).not.toContain("bg-yellow-400");
  });

  test("cancel leaves the trip alone", async () => {
    inventory(0, 1);
    await pressDelete();
    const cancel = container!.querySelectorAll('[role="dialog"] button')[1] as HTMLButtonElement;
    act(() => cancel.click());
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  test("a trip with days still asks, and deletes after confirm", async () => {
    inventory(1, 2);
    await pressDelete();
    expect(container!.querySelector('[role="dialog"] p')!.textContent).toContain("1 day and 2 files");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, set href(value: string) { assign(value); } });
    await act(async () => confirmButton().click());
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      { url: "/alex/trips/empty/delete", method: "POST" },
    ]);
  });
});

describe("B2052 — GET .../delete opened in a browser", () => {
  const params = Promise.resolve({ user: "alex", trip: "empty" });

  test("a navigation is sent to the trip's studio page, not handed raw JSON", async () => {
    const { GET } = await import("@/app/[user]/trips/[trip]/delete/route");
    const response = await GET(
      new Request("https://fernscout.ch/alex/trips/empty/delete", { headers: { "sec-fetch-mode": "navigate" } }),
      { params },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/alex/studio/trip?trip=empty");
  });

  test("the page's own fetch still gets the inventory", async () => {
    const { GET } = await import("@/app/[user]/trips/[trip]/delete/route");
    const response = await GET(new Request("https://fernscout.ch/alex/trips/empty/delete"), { params });
    expect(await response.json()).toEqual({ title: "Empty trip", days: 0, files: 1, size: "10 B" });
  });
});

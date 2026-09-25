// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2088 — revisiting "Who was there" lists the people already added, with
 * edit and a remove that asks first; and no locale promises per-day
 * companions, which do not exist (people are per trip).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }),
  usePathname: () => "/alex/studio/people",
  useSearchParams: () => new URLSearchParams(""),
}));

const { default: PeopleFlow } = await import("@/components/studio/people/PeopleFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root | undefined;
let container: HTMLDivElement;
let calls: { url: string; body: Record<string, unknown> | null }[] = [];

function mount(people: { id: string; name: string | null; email: string; trips: string[] }[]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username="alex">
          <PeopleFlow
            username="alex"
            trips={[{ id: "alps", title: "Alps" }]}
            defaultTripId="alps"
            photoConsent={false}
            photoCredits={0}
            people={people}
          />
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
}
function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}

beforeEach(() => {
  sessionStorage.clear();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("/figures")) return new Response(JSON.stringify({ figures: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, deleted: true }), { status: 200 });
    }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("People you already have — B2088", () => {
  test("a revisit renders the list with a known contact and its trips", () => {
    mount([{ id: "c1", name: "Test Person", email: "test-w6c-1@fernscout.ch", trips: ["Alps"] }]);
    expect(container.textContent).toContain("People you already have");
    expect(container.textContent).toContain("Test Person");
    expect(container.textContent).toContain("test-w6c-1@fernscout.ch");
    expect(container.textContent).toContain("Alps");
  });

  test("an empty journal says so in one sentence", () => {
    mount([]);
    expect(container.textContent).toContain("Nobody yet");
  });

  test("Remove asks before deleting, and deletes only on the confirm", async () => {
    mount([{ id: "c1", name: "Test Person", email: "test-w6c-1@fernscout.ch", trips: [] }]);
    await act(async () => button("Remove").click());
    expect(calls.some((c) => c.body?.action === "delete")).toBe(false);
    expect(container.textContent).toContain("Remove Test Person?");
    await act(async () => button("Remove Test Person").click());
    const del = calls.find((c) => c.body?.action === "delete");
    expect(del?.url).toBe("/api/contacts/admin");
    expect(del?.body).toMatchObject({ user: "alex", action: "delete", id: "c1" });
    expect(container.textContent).not.toContain("test-w6c-1@fernscout.ch");
  });

  test("Edit saves name and email through the contacts admin update", async () => {
    mount([{ id: "c1", name: "Test Person", email: "test-w6c-1@fernscout.ch", trips: [] }]);
    await act(async () => button("Edit").click());
    const name = container.querySelector('input[type="text"][name="name"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Renamed Person");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save").click());
    expect(calls.find((c) => c.body?.action === "update")?.body).toMatchObject({
      user: "alex",
      action: "update",
      id: "c1",
      name: "Renamed Person",
      email: "test-w6c-1@fernscout.ch",
    });
    expect(container.textContent).toContain("Renamed Person");
  });
});

describe("no per-day companion promise — B2088", () => {
  const read = (l: string) =>
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "site", "locales", `${l}.json`), "utf8")) as Record<string, string>;
  test.each([
    ["en", /on a day/i],
    ["de", /an einem Tag/i],
    ["hu", /egy napon/i],
  ])("%s: no people string promises who was on a day", (l, pattern) => {
    const offenders = Object.entries(read(l)).filter(([k, v]) => k.startsWith("studio.people.") && pattern.test(v));
    expect(offenders).toEqual([]);
  });
  test("the old consequence wording is gone", () => {
    expect(read("en")["studio.people.what.consequence"]).not.toContain("who was on a day");
  });
});

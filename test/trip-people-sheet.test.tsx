// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B-2847 - "Who's on this trip?" writes the trip's byline and nothing else.
 * A typed name is stored name-only; a picked contact carries its address.
 * No call goes to anything that invites, grants, mails or reads a reader.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/@alex/studio/trip",
  useSearchParams: () => new URLSearchParams(),
}));

const { TripPeopleRow } = await import("@/components/studio/trip/TripPeopleSheet");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <ul>
          <TripPeopleRow
            defaultOpen
            username="alex"
            tripId="t1"
            owner={{ name: "Alex", email: "alex@example.test" }}
            initialPeople={[]}
            contacts={[{ name: "Robin Fox", email: "robin@example.test" }]}
            initialFigures={[]}
            figureSet={[]}
            photoConsent={false}
          />
        </ul>
      </LocaleProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
async function addByText(value: string) {
  const input = container.querySelector<HTMLInputElement>("#trip-people-add")!;
  act(() => type(input, value));
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Who's on this trip?", () => {
  test("opens by itself, labelled, with the owner first and the no-access line", () => {
    const dialog = container.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("trip-people-title");
    expect(container.querySelector("li")!.textContent).toContain("You (Alex)");
    expect(dialog.textContent).toContain("sends nothing and gives no access");
  });

  test("a typed name is stored name-only, a contact with its address, and nothing else is called", async () => {
    await addByText("Maya");
    await addByText("Robin Fox");
    const writes = calls.filter((c) => c.method === "PATCH");
    expect(writes[0].body).toEqual({ people: [{ name: "Alex", email: "alex@example.test" }, { name: "Maya" }] });
    expect(writes[1].body).toEqual({
      people: [{ name: "Alex", email: "alex@example.test" }, { name: "Maya" }, { name: "Robin Fox", email: "robin@example.test" }],
    });
    // Only the trip's own byline door: no invite, grant, mail or reader call.
    expect(calls.map((c) => c.url)).toEqual(["/api/web/alex/trips/t1", "/api/web/alex/trips/t1"]);
  });

  test("removing a person rewrites the byline without them", async () => {
    await addByText("Maya");
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove Maya"]')!;
    await act(async () => remove.click());
    expect(calls[calls.length - 1].body).toEqual({ people: [{ name: "Alex", email: "alex@example.test" }] });
  });

  test("Done closes the sheet and leaves the row", () => {
    const done = [...container.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
    act(() => done.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Who’s on this trip?");
  });
});

describe("Who's on this trip? photo consent in place (B-2906)", () => {
  function renderWith(photoAsk?: { provider: string; declined: boolean }) {
    act(() =>
      root.render(
        <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
          <ul>
            <TripPeopleRow
              defaultOpen
              username="alex"
              tripId="t1"
              owner={{ name: "Alex" }}
              initialPeople={[]}
              contacts={[]}
              initialFigures={[]}
              figureSet={[]}
              photoConsent={false}
              photoAsk={photoAsk}
            />
          </ul>
        </LocaleProvider>,
      ),
    );
  }
  const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  test("helper off: only the needs-assistant line", () => {
    expect(container.textContent).toContain("needs the assistant");
    expect(container.querySelector("[data-photo-ask]")).toBeNull();
  });

  test("question with provider; Yes posts scope photos and reveals the button", async () => {
    renderWith({ provider: "Acme Models", declined: false });
    expect(container.querySelector("[data-photo-ask]")!.textContent).toContain("goes to Acme Models");
    expect(button("Make figures from a photo")).toBeUndefined();
    await act(async () => button("Yes, use the assistant")!.click());
    expect(calls).toEqual([{ url: "/api/helper/alex/consent", method: "POST", body: { scope: "photos" } }]);
    expect(button("Make figures from a photo")).toBeDefined();
    expect(container.querySelector("[data-photo-ask]")).toBeNull();
  });

  test("Not now hides the question and records nothing", () => {
    renderWith({ provider: "Acme Models", declined: false });
    act(() => button("Not now")!.click());
    expect(container.querySelector("[data-photo-ask]")).toBeNull();
    expect(button("Make figures from a photo")).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("declined earlier: only a quiet link to the assistant settings", () => {
    renderWith({ provider: "Acme Models", declined: true });
    expect(container.querySelector("[data-photo-ask]")).toBeNull();
    const link = container.querySelector<HTMLAnchorElement>('a[href$="/studio/agent"]')!;
    expect(link.textContent).toContain("Photo help is off");
  });
});

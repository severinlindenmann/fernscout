// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B1018 — who gets an address on the send step.
 *
 * The rule has two halves and the first one is what broke: **every candidate
 * has to arrive with their envelope**, because since B1005 the owner can tick
 * somebody who was not on the order and that person is exactly the one whose
 * address they want to check; and **only a ticked one is shown**, because
 * B434's reasoning about four home addresses on a phone at a table has not
 * changed.
 *
 * This file holds the second half — what the component does with what it is
 * given. The first half is a fact about `addressesFor`, which the page now
 * relies on for candidates who are on no order, and it is asserted where that
 * function's own fixture lives (`test/postcard-orders.test.ts`).
 */

const refresh = vi.fn();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const CANDIDATES = [
  {
    contactId: "on-the-order",
    name: "Oma Berger",
    city: "Wohlenschwil",
    country: "CH",
    readsNote: null,
    address: { line1: "Feldweg 18", line2: "", postcode: "5512", city: "Wohlenschwil" },
  },
  {
    contactId: "not-yet",
    name: "Viktoria Berger",
    city: "Wohlenschwil",
    country: "CH",
    readsNote: "usually reads Magyar",
    address: { line1: "Feldweg 18", line2: "", postcode: "5512", city: "Wohlenschwil" },
  },
];

const STRINGS = {
  heading: "Going to 1 person",
  save: "Save who gets one",
  saving: "Saving…",
  saved: "Saved",
  failed: "Not saved",
  lost: null,
  none: "Nobody has asked yet.",
};

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: "saved" })));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.unstubAllGlobals();
  vi.doUnmock("next/navigation");
  vi.resetModules();
});

async function mount(chosen: string[] = ["on-the-order"], editable = true) {
  const { default: PostcardPeople } = await import(
    "@/app/[user]/postcards/[id]/PostcardPeople"
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <PostcardPeople
        username="ana"
        id="abc"
        candidates={CANDIDATES}
        chosen={chosen}
        editable={editable}
        strings={STRINGS}
      />,
    );
  });
}

const boxes = () =>
  [...container!.querySelectorAll<HTMLInputElement>("input[name=recipient]")];
const addressesShown = () =>
  [...container!.querySelectorAll("address")].map((a) => a.textContent ?? "");

describe("the address on the send step", () => {
  test("a ticked recipient has one, and an unticked one does not", async () => {
    await mount();
    expect(addressesShown()).toHaveLength(1);
    expect(addressesShown()[0]).toContain("Feldweg 18");
  });

  test("ticking somebody new gives them the disclosure at once", async () => {
    await mount();
    const second = boxes().find((b) => b.value === "not-yet")!;
    // A real click: the browser toggles the box and React hears its own
    // change. Setting `.checked` by hand and firing `change` does not — React
    // tracks the previous value and treats it as unchanged.
    act(() => second.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // The regression: the second person arrived with `address: null`, so they
    // got no disclosure however often they were ticked.
    expect(addressesShown()).toHaveLength(2);
  });

  test("unticking takes it away again", async () => {
    await mount(["on-the-order", "not-yet"]);
    expect(addressesShown()).toHaveLength(2);
    const first = boxes().find((b) => b.value === "on-the-order")!;
    act(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(addressesShown()).toHaveLength(1);
  });

  test("an address is never in the open — it is inside a details", async () => {
    await mount(["on-the-order", "not-yet"]);
    for (const address of container!.querySelectorAll("address")) {
      expect(address.closest("details")).not.toBeNull();
    }
  });

  test("a sent order shows who it went to and offers no way to change it", async () => {
    await mount(["on-the-order"], false);
    expect(boxes().every((b) => b.disabled)).toBe(true);
    expect(container!.textContent).not.toContain(STRINGS.save);
  });
});

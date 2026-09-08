// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HelperRoom from "@/components/HelperRoom";
import LocaleProvider from "@/components/LocaleProvider";
import type { RoomFiles } from "@/lib/helper/server";
import { dictionaryFor } from "@/lib/locales";

/**
 * The three panes — B901 and B902, checklists C and D of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * Same jsdom + `createRoot` harness as `test/helper-chat.test.tsx`, and the
 * same reason: one component, no second testing library.
 *
 * What is asserted is the shape a person works in. The three regions exist and
 * are named, so a screen reader says which one it is in. **At 390px neither
 * side pane is drawn at all** — that is a class assertion rather than a
 * measurement, because jsdom has no layout, and it is the honest one: the
 * panes are `hidden` until `lg`, so there is nothing to compete with the
 * conversation and nothing is half a screen wide. The selection is a real
 * checkbox each, which is what makes the pane operable with a keyboard, and
 * what a sentence carries with it is the ids of what is ticked.
 *
 * jsdom implements neither `showModal` nor `close` on `<dialog>` (30.0.1), so
 * the sheet is asserted as a dialog with a way out rather than as a modal
 * being opened; the platform is what makes it modal in a browser, which is
 * the whole reason it is a `<dialog>`.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string; body: Record<string, unknown> }[] = [];

const dictionary = dictionaryFor("en");

const FILES: RoomFiles = {
  inbox: [
    { id: "inbox:aaa111-statement.csv", name: "statement.csv" },
    { id: "inbox:bbb222-harbour.jpg", name: "harbour.jpg" },
  ],
  trip: [{ id: "photo:tuesday:/u/media/x/01.jpg", name: "The harbour", src: "/u/media/x/01.jpg" }],
  tripTitle: "A Trip",
};

const CURRENCY = { base: "CHF", currencies: ["CHF"] } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({
        url,
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      });
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );
});

function render(
  opening: { trip: string; slug: string } | null = null,
  files: RoomFiles = FILES,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <HelperRoom
          username="alex"
          title="A Journal"
          files={files}
          currency={CURRENCY}
          opening={opening}
          consented
          speech={false}
          consentedSpeech={false}
          speechProvider="dry-run"
        />
      </LocaleProvider>,
    );
  });
  return container!;
}

/** React listens for the setter rather than for an assignment, the same way
 *  `test/helper-chat.test.tsx` has to type. */
function type(box: HTMLElement, value: string) {
  const field = box.querySelector<HTMLInputElement>("input[type=text]")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const regions = () =>
  [...document.querySelectorAll("section[aria-label], main")].map((node) =>
    node.getAttribute("aria-label"),
  );

test("the three panes are three named regions, with the conversation between them", () => {
  render();
  const named = regions();
  expect(named).toContain("Files");
  expect(named).toContain("How it looks");
  // The conversation is `HelperAsk`'s own region and is open from the first
  // render in the room — there is no line to press first.
  expect(named).toContain("Conversation");
  expect(document.querySelector("input[type=text]")).not.toBeNull();
});

test("at 390px neither side pane is drawn", () => {
  render();
  for (const label of ["Files", "How it looks"]) {
    const pane = document.querySelector(`section[aria-label="${label}"]`)!;
    expect(pane.className).toContain("hidden");
    expect(pane.className).toContain("lg:");
  }
  // And the two things that do come up on a phone are not up until asked for.
  expect(document.querySelector("dialog")).toBeNull();
});

test("the panes are dismissible from the keyboard, and the conversation stays", () => {
  render();
  const hide = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Hide files",
  )!;
  act(() => hide.click());
  expect(regions()).not.toContain("Files");
  expect(regions()).toContain("Conversation");
  act(() => {
    ([...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Show files",
    ) as HTMLButtonElement).click();
  });
  expect(regions()).toContain("Files");
});

test("a selection is made with checkboxes and travels with the next sentence", async () => {
  const box = render();
  const ticks = [...box.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  // Two inbox files and one photograph already on a day — the pane holds both
  // folders, which is the whole of B902.
  expect(ticks).toHaveLength(3);

  act(() => ticks[1].click());
  act(() => ticks[2].click());

  type(box, "put these on yesterday");
  const ask = [...box.querySelectorAll("button")].find((button) => button.textContent === "Ask")!;
  await act(async () => {
    ask.click();
  });

  const sent = calls.find((call) => call.url.endsWith("/ask"))!;
  expect(sent.body.said).toBe("put these on yesterday");
  expect(sent.body.selected).toEqual([
    "inbox:bbb222-harbour.jpg",
    "photo:tuesday:/u/media/x/01.jpg",
  ]);
});

test("nothing selected sends nothing, so the conversation is unchanged", async () => {
  const box = render();
  type(box, "how many trips do I have");
  await act(async () => {
    ([...box.querySelectorAll("button")].find(
      (button) => button.textContent === "Ask",
    ) as HTMLButtonElement).click();
  });
  const sent = calls.find((call) => call.url.endsWith("/ask"))!;
  expect(sent.body).not.toHaveProperty("selected");
});

test("the preview is empty until the conversation is about a day, and says so", () => {
  render();
  expect(container!.textContent).toContain("Whatever you are talking about appears here");
  expect(calls.filter((call) => call.url.includes("/day?"))).toHaveLength(0);
});

test("a day the room opens with is read from the same route the wizard reads", () => {
  render({ trip: "a-trip", slug: "tuesday" });
  expect(calls[0].url).toBe("/api/helper/alex/day?trip=a-trip&slug=tuesday");
});

test("the files sheet is a dialog with one obvious way back", () => {
  const box = render();
  const open = [...box.querySelectorAll("button")].find(
    (button) => button.textContent === "Files",
  )!;
  act(() => open.click());
  const sheet = document.querySelector("dialog")!;
  expect(sheet.getAttribute("aria-label")).toBe("Files");
  // The same pane, the same checkboxes: one selection, two places to make it.
  expect(sheet.querySelectorAll("input[type=checkbox]")).toHaveLength(3);
  const back = [...sheet.querySelectorAll("button")].find(
    (button) => button.textContent === "Close",
  )!;
  act(() => back.click());
  expect(document.querySelector("dialog")).toBeNull();
});

/**
 * A live region has to exist before the thing it announces — B949.
 *
 * The count of picked files sat behind `selected.length > 0`, so the region
 * was created at the same moment as its first content, and a screen reader
 * may never announce that first change: there was nothing there to be
 * watched. Somebody ticking their first photograph heard nothing at all, and
 * would have had to tab onward and find the "Clear" button to discover that
 * anything had happened.
 *
 * The conversation log on the same screen already had this fixed, with the
 * reason written beside it. This is the second region, which did not.
 */
describe("the files pane's count", () => {
  test("its region is mounted before anything is picked", () => {
    const box = render();
    const counts = [...box.querySelectorAll('[role="status"]')];
    // Not "is there once something is selected" — there, now, empty.
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.some((one) => one.textContent === "")).toBe(true);
  });
});

/**
 * The column that held nothing — B947.
 *
 * A designer on a laptop, asked which one thing she would cut: the files
 * column, which holds 256px of muted placeholder on a journal with an empty
 * inbox, never changes shape, and takes that width from the conversation —
 * the pane that matters, on the layout most likely to be opened on a laptop.
 *
 * It is not hidden. The toggle is in the header either way and one press
 * brings it back; what changes is which state somebody with nothing to attach
 * starts in.
 */
describe("the files column on a journal with nothing waiting", () => {
  const EMPTY: RoomFiles = { inbox: [], trip: [], tripTitle: "A Trip" };

  test("does not open on its own", () => {
    const box = render(null, EMPTY);
    expect(box.querySelector('section[aria-label="Files"]')).toBeNull();
  });

  test("but the way back to it is still there", () => {
    const box = render(null, EMPTY);
    const labels = [...box.querySelectorAll("button")].map((one) => one.textContent);
    expect(labels).toContain("Show files");
  });

  test("and a journal with something waiting still opens on it", () => {
    const box = render();
    expect(box.querySelector('section[aria-label="Files"]')).not.toBeNull();
  });
});

/**
 * Adding a photograph, not only offering one — B984.
 *
 * The wizard was the only page that could put a photograph on a day; the room
 * had a preview and a pane of what was already waiting, and no way to add
 * to it. The picker now lives in the files pane too, aimed at whichever day
 * the conversation is about — and refuses to guess when there is none.
 */
describe("adding a photograph from the files pane", () => {
  test("the picker appears once a day is under discussion", () => {
    const box = render({ trip: "a-trip", slug: "tuesday" });
    expect(box.querySelector('input[type="file"]')).not.toBeNull();
    expect(box.textContent).toContain("Choose files");
  });

  test("with no day under discussion, the pane says so instead of offering a picker", () => {
    const box = render();
    expect(box.querySelector('input[type="file"]')).toBeNull();
    expect(box.textContent).toContain("Say which day you mean first");
  });
});

/**
 * What is kept, said once before anything is said to it — B976.
 *
 * Their conversations are saved so they can come back to them, and nobody
 * else reads them unless they allow it. It belongs on an empty screen and
 * nowhere else: repeated above every turn it becomes furniture nobody reads,
 * and shown after somebody has already talked it is late.
 */
describe("the notice about what is kept", () => {
  test("is the first thing on an empty conversation", () => {
    const box = render();
    expect(box.textContent).toContain("Your conversations are saved");
    // And it says the part a person would otherwise have to guess.
    expect(box.textContent).toContain("Nobody else reads them unless you say so");
  });
});

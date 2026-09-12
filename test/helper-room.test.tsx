// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HelperRoom from "@/components/HelperRoom";
import LocaleProvider from "@/components/LocaleProvider";
import type { RoomFiles } from "@/lib/helper/server";
import { dictionaryFor } from "@/lib/locales";
import { typeInto } from "./support/type-input";

// The room's own header carries a `BackLink` since B1121, which reads
// `useRouter()` and renders `next/link` — the same stubs
// `test/agent-short-consent.test.tsx` and `test/signup-wizard.test.tsx`
// already use for the same component tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

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

const CURRENCY = { base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } } as never;

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
  journals?: { username: string; title: string }[],
  history?: { created_at: string; said: string | null; answered: string | null; origin?: string | null }[],
  credits: number | null = null,
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
          first={{ state: "empty" }}
          consented
          speech={false}
          consentedSpeech={false}
          speechProvider="dry-run"
          siteUrl="https://t.test"
          journals={journals}
          history={history}
          credits={credits}
        />
      </LocaleProvider>,
    );
  });
  return container!;
}

function type(box: HTMLElement, value: string) {
  const field = box.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => {
    typeInto(field, value);
  });
}

const regions = () =>
  [...document.querySelectorAll("section[aria-label], main")].map((node) =>
    node.getAttribute("aria-label"),
  );

test("B814 — the room has a heading to land on, with one journal or with several", () => {
  render();
  expect(document.querySelector("h1")).not.toBeNull();
  act(() => root?.unmount());
  container?.remove();

  render(null, FILES, [
    { username: "alex", title: "A Journal" },
    { username: "sam", title: "Another Journal" },
  ]);
  const heading = document.querySelector("h1");
  expect(heading).not.toBeNull();
  // The switcher is still the visible control; the heading is there for
  // navigation, not to duplicate what the `<select>` already says.
  expect(heading!.className).toContain("sr-only");
});

test("the three panes are named regions, the preview closed until it has content — B1320", () => {
  render();
  const named = regions();
  expect(named).toContain("Files");
  // The preview starts as a collapsed rail (a button, not a region): an
  // open column holding an empty-state sentence was dead space — B1320.
  expect(named).not.toContain("Preview");
  expect(
    [...document.querySelectorAll("button")].some(
      (one) => one.getAttribute("aria-label") === "Show preview",
    ),
  ).toBe(true);
  // The conversation is `HelperAsk`'s own region and is open from the first
  // render in the room — there is no line to press first.
  expect(named).toContain("Conversation");
  expect(document.querySelector("textarea")).not.toBeNull();
});

test("at 390px neither side pane is drawn", () => {
  render();
  // The preview rail starts collapsed (B1320), so only the files pane is a
  // section here; both shapes carry the same hidden-until-lg classes.
  const pane = document.querySelector('section[aria-label="Files"]')!;
  expect(pane.className).toContain("hidden");
  expect(pane.className).toContain("lg:");
  // And the two things that do come up on a phone are not up until asked for.
  expect(document.querySelector("dialog")).toBeNull();
});

test("the panes are dismissible from the keyboard, and the conversation stays", () => {
  const box = render();
  // The rail's own collapse icon, at the edge of the panel it closes — B1121
  // moved this off a header sentence, so it is found by its accessible name.
  const hide = [...box.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Hide files",
  )!;
  act(() => hide.click());
  expect(regions()).not.toContain("Files");
  expect(regions()).toContain("Conversation");
  // Collapsed, the rail is a single button carrying the count — B1121.
  act(() => {
    ([...box.querySelectorAll("button")].find((button) =>
      (button.getAttribute("aria-label") ?? "").startsWith("Files"),
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
  const ask = box.querySelector('button[aria-label="Ask"]') as HTMLButtonElement;
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
      (button) => button.getAttribute("aria-label") === "Ask",
    ) as HTMLButtonElement).click();
  });
  const sent = calls.find((call) => call.url.endsWith("/ask"))!;
  expect(sent.body).not.toHaveProperty("selected");
});

test("the preview stays a closed rail until the conversation is about a day — B1320", () => {
  render();
  // Closed, and nothing fetched: an empty column with a sentence in it was
  // what this replaced.
  expect(document.querySelector('section[aria-label="Preview"]')).toBeNull();
  expect(calls.filter((call) => call.url.includes("/day?"))).toHaveLength(0);
});

test("a day the room opens with is read from the same route the wizard reads", () => {
  render({ trip: "a-trip", slug: "tuesday" });
  // Among the mount's requests, not the first of them — the files pane's own
  // storage read (B1340) also fires on mount, and order is not the claim.
  expect(calls.map((call) => call.url)).toContain("/api/helper/alex/day?trip=a-trip&slug=tuesday");
});

test("a turn that arrived over WhatsApp carries the mark, and a web turn carries nothing — B1344", () => {
  const page = render(null, FILES, undefined, [
    { created_at: "2026-09-10T08:00:00Z", said: "vom Handy", answered: "ok", origin: "whatsapp" },
    { created_at: "2026-09-10T09:00:00Z", said: "vom Browser", answered: "ok", origin: "web" },
  ]);
  const marks = page.querySelectorAll(`svg[aria-label="${dictionary["agent.chat.viaWhatsapp"]}"]`);
  expect(marks).toHaveLength(1);
});

test("the files tab is a full view with the same pane, one tap away — B1215", () => {
  const box = render();
  // The way in is the composer's paperclip (or the strip); a tap lands on
  // the Dateien tab, not a sheet: nothing overlays the conversation.
  const open = [...box.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Files",
  )!;
  act(() => open.click());
  expect(document.querySelector("dialog")).toBeNull();
  const pane = [...document.querySelectorAll("section")].find(
    (one) => one.getAttribute("aria-label") === "Files" && one.className.includes("lg:hidden"),
  )!;
  // The same pane, the same checkboxes: one selection, two places to make it.
  expect(pane.querySelectorAll("input[type=checkbox]")).toHaveLength(3);
  // And the way back is the tab bar's own Chat tab.
  const chat = [...document.querySelectorAll<HTMLButtonElement>("nav button")].find(
    (button) => (button.textContent ?? "").includes("Chat"),
  )!;
  act(() => chat.click());
  expect(
    [...document.querySelectorAll("section")].some(
      (one) => one.getAttribute("aria-label") === "Files" && one.className.includes("lg:hidden"),
    ),
  ).toBe(false);
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
    // Collapsed to the ~40px rail rather than gone — B1121. No count badge
    // on an empty journal, so the accessible name is the plain "Files".
    const labels = [...box.querySelectorAll("button")].map((one) => one.getAttribute("aria-label"));
    expect(labels).toContain("Files");
  });

  test("and a journal with something waiting still opens on it", () => {
    const box = render();
    expect(box.querySelector('section[aria-label="Files"]')).not.toBeNull();
  });
});

/**
 * Adding a file, into the inbox — B984 put the picker in the room, B1171
 * pointed it at the inbox.
 *
 * It used to be aimed at whichever day the conversation was about — on a
 * fresh visit, a months-old draft nobody chose — and offered nothing at all
 * with no subject. Everything lands in the inbox now, whatever the
 * conversation is about, so the picker is simply always there.
 */
describe("adding a file from the files pane", () => {
  test("the picker is there with a day under discussion", () => {
    const box = render({ trip: "a-trip", slug: "tuesday" });
    expect(box.querySelector('input[type="file"]')).not.toBeNull();
    expect(box.textContent).toContain("Choose files");
  });

  test("and there with no day under discussion too", () => {
    const box = render();
    expect(box.querySelector('input[type="file"]')).not.toBeNull();
    expect(box.textContent).toContain("Choose files");
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
    // **It says that reading happens**, rather than implying a permission
    // nobody gave — the switch is on by default, so a notice worded as a
    // promise of privacy would be the dishonest version of this.
    expect(box.textContent).toContain("We read them to make Fernscout better");
    expect(box.textContent).toContain("turn that off");
  });
});

/**
 * A chip is a shortcut for typing, consent gate included — B1020.
 *
 * The chips in the opening used to call `ask()` on their own, past the same
 * check the field's own Ask button goes through first. A first-time owner
 * pressing the brightest thing on the screen landed on
 * "this journal has not yet agreed to a model being spoken to. Agree on the
 * panel above" — with no panel anywhere on it. This presses a chip on a
 * journal that has not consented and expects the panel, not the error.
 */
test("a chip in the opening opens the consent panel rather than dead-ending on it", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <HelperRoom
          username="alex"
          title="A Journal"
          files={FILES}
          currency={CURRENCY}
          opening={null}
          first={{ state: "clear", lastDate: "2026-04-01" }}
          consented={false}
          speech={false}
          consentedSpeech={false}
          speechProvider="dry-run"
          siteUrl="https://t.test"
        />
      </LocaleProvider>,
    );
  });

  const chip = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "New day",
  )!;
  act(() => chip.click());

  expect(container.textContent).not.toContain("has not yet agreed");
  expect(container.textContent).toContain("Sends what you type");
});

/**
 * The two mobile pills, and where they went — B1016.
 *
 * "Files" and "Preview" sat in the header, one of them disabled until a
 * day was under discussion — a new owner's first impression of the room. Both
 * are chrome for things that are local, and both are gone from here; what
 * replaced them is checked below.
 */
test("the header carries no pills for files or preview", () => {
  render();
  const labels = [...document.querySelector("header")!.querySelectorAll("button")].map(
    (button) => button.textContent,
  );
  expect(labels).not.toContain("Files");
  expect(labels).not.toContain("Preview");
});

/**
 * The top bar's own two icons — B1121. A clock opening a history panel (the
 * shell only; B1109 owns its contents) and one accent button starting a new
 * conversation, and nothing else.
 */
describe("the top bar's two icons", () => {
  test("the clock opens a history panel, empty for a journal with no past conversations", async () => {
    render();
    const clock = [...document.querySelector("header")!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "History",
    )!;
    expect(document.querySelector("dialog")).toBeNull();
    await act(async () => {
      clock.click();
    });
    const panel = document.querySelector("dialog")!;
    expect(panel.getAttribute("aria-label")).toBe("History");
    // The global `fetch` stub answers every call with `{ ok: true, blocks: [] }`
    // — no `sessions` at all — which is exactly the shape a journal with none
    // yet gets back for real, so the empty state is what this exercises.
    expect(panel.textContent).toContain("Nothing yet");
  });

  test("lists past conversations grouped by day, newest first, as a link to reopen one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sessions")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              sessions: [
                { session: "s2", from: "2026-09-09T10:00:00.000Z", to: "2026-09-09T10:05:00.000Z", turns: 1, opening: "1 baht is how many francs" },
                { session: "s1", from: "2026-09-08T09:00:00.000Z", to: "2026-09-08T09:20:00.000Z", turns: 3, opening: "how many credits do I have left?" },
              ],
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
      }),
    );
    render();
    const clock = [...document.querySelector("header")!.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "History",
    )!;
    await act(async () => {
      clock.click();
    });
    const panel = document.querySelector("dialog")!;
    const links = [...panel.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/agent?c=s2",
      "/agent?c=s1",
    ]);
    expect(links[0].textContent).toContain("1 baht is how many francs");
    expect(links[0].textContent).toContain("1 turn");
    expect(links[1].textContent).toContain("how many credits do I have left?");
    expect(links[1].textContent).toContain("3 turns");
  });

  test("a new conversation button sits beside it", () => {
    render();
    const named = [...document.querySelector("header")!.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(named).toContain("New conversation");
  });
});

/**
 * B1574 — the keys/tokens list (`agent.room.keysTitle`) used to sit inside
 * this sheet, above the balance, per B1154's 2026-09-09 decision record. The
 * person reported it read as out of place in a screen about money, and asked
 * for it out entirely; `/<user>/me`'s own device list is the one remaining
 * place for it (`components/AgentKeys.tsx`, unaffected by this).
 */
test("the account sheet shows balance, not a list of keys", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/account")) {
        return {
          ok: true,
          json: async () => ({
            credits: 42,
            monthSpent: 3,
            storage: { usedBytes: 0, ceilingBytes: null },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );
  const box = render(null, FILES, undefined, undefined, 42);
  const chip = [...box.querySelector("header")!.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Credits",
  )!;
  await act(async () => {
    chip.click();
  });
  const sheet = document.querySelector('dialog[aria-label="Credits"]')!;
  expect(sheet).not.toBeNull();
  await act(async () => {
    await Promise.resolve();
  });
  expect(sheet.textContent).toContain("42");
  expect(sheet.textContent).not.toMatch(/keys that can write here/i);
});

/**
 * The preview sheet appears only when asked for — B1170, deleting B1121's
 * self-peeking two-height sheet. It rose by itself the moment the
 * conversation named a day, inserted 112px into the layout flow under the
 * composer, and could never be dismissed back to hidden. Now nothing on the
 * phone layout appears without a press: a day under discussion on arrival
 * (`?about=`) feeds the preview panes, and the sheet stays closed until a
 * turn's own chip opens it.
 */
test("a day under discussion does not open the preview sheet by itself", () => {
  const box = render({ trip: "a-trip", slug: "tuesday" });
  expect(box.querySelector('dialog[aria-label="Preview"]')).toBeNull();
});

test("with nothing under discussion, there is no sheet either", () => {
  const box = render();
  expect(box.querySelector('dialog[aria-label="Preview"]')).toBeNull();
});

/**
 * The preview, inline in the turn that named the day — B1016.
 *
 * "A really small emoji or thumbnail in the chat with a button Preview, and
 * not a button at the top" was the owner's own reading, and this is that: a
 * turn ending in a proposal that names a day carries a small card, and
 * pressing it is what used to take a header button.
 */
test("a turn that named a day carries a preview affordance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/ask")) {
        return {
          ok: true,
          json: async () => ({
            blocks: [
              {
                shape: "confirm",
                text: "Publish this day?",
                proposal: {
                  tool: "publish_day",
                  // No `date` — the card falls back to a plain label, which
                  // is what makes this assertion locale-independent.
                  arguments: { trip: "a-trip", slug: "tuesday" },
                  sentence: "Publish this day?",
                  fields: [],
                  endpoint: "/api/helper/alex/day/publish",
                  method: "POST",
                  accept: "Publish",
                  done: "Published.",
                },
              },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ preview: null }) } as Response;
    }),
  );

  const box = render();
  type(box, "publish tuesday");
  const ask = box.querySelector('button[aria-label="Ask"]') as HTMLButtonElement;
  await act(async () => {
    ask.click();
  });

  const chip = [...box.querySelectorAll("button")].find((button) =>
    // The marker's emoji is part of the button's own text too (`aria-hidden`
    // only hides it from a screen reader, not from `textContent`), so this
    // checks for the label rather than the label alone.
    (button.textContent ?? "").includes("Preview"),
  );
  expect(chip).toBeDefined();

  // No `matchMedia` in jsdom — the room reads that defensively and falls back
  // to the phone's own behaviour, which is the Vorschau tab — B1215.
  // Nothing is open before the press; pressing the chip switches tabs.
  const previewTab = () =>
    [...document.querySelectorAll("section")].some(
      (one) =>
        one.getAttribute("aria-label") === "Preview" && one.className.includes("lg:hidden"),
    );
  expect(previewTab()).toBe(false);
  act(() => chip!.click());
  expect(previewTab()).toBe(true);
});

/**
 * One press, one card — B1274.
 *
 * Reproduced live at 390×844: pressing the preview header's "Put this day on
 * the site" exactly once fired three identical `POST /proposal` calls and
 * stacked three publish cards, each with its own live "Put it on the site"
 * button. `proposeToThread` had no guard against a re-entrant call, so
 * whatever produced the repeat — a double tap, a duplicate handler — reached
 * the network every time.
 */
test("pressing the preview's publish button twice quickly fires one proposal", async () => {
  const proposalCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/day?trip=")) {
        return {
          ok: true,
          json: async () => ({
            preview: {
              day: {
                date: "2026-08-01",
                lead: {
                  slug: "tuesday",
                  title: "Ankunft",
                  date: "2026-08-01",
                  location: "Bellinzona",
                  country: "Switzerland",
                  content: "<p>Words.</p>",
                  gallery: [],
                  costs: [],
                  draft: true,
                },
                entries: [],
              },
              summary: {},
              dayIndex: 0,
            },
          }),
        } as Response;
      }
      if (url.endsWith("/proposal")) {
        proposalCalls.push(url);
        return { ok: true, json: async () => ({ blocks: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );

  const box = render({ trip: "a-trip", slug: "tuesday" });
  // Let the day-preview `GET` (fired by the `opening` prop) land, so the
  // draft's own publish button is on screen.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const previewSection = box.querySelector('section[aria-label="Preview"]')!;
  const publish = [...previewSection.querySelectorAll("button")].find(
    // B1275 relabelled this button — it opens a card, it does not publish.
    (button) => button.textContent === dictionary["agent.room.reviewToPublish"],
  ) as HTMLButtonElement;
  expect(publish).toBeDefined();

  // Two rapid presses, the shape a double tap on a phone takes — both land
  // inside the same tick, before the in-flight guard's own `finally` runs.
  act(() => {
    publish.click();
    publish.click();
  });

  expect(proposalCalls).toHaveLength(1);
  // And the guard is visible, not just internal: a second click found the
  // button disabled.
  expect(publish.disabled).toBe(true);
});

/**
 * B1275 — the preview header's button never published: `proposeToThread`
 * only ever POSTs to `/proposal` and injects the card that names the real
 * route, exactly like every other proposal in this conversation. Two things
 * worth locking down: the label says what pressing it actually does, and
 * the card it opens is the one the person actually sees — present in the
 * thread, not merely present in a hidden tab. (Since B1560 that card is
 * scrolled into view within the log's own box, never with `scrollIntoView`
 * — see `test/helper-chat.test.tsx`'s B1253 block for why.)
 */
test("the header's publish button opens the real confirmation card", async () => {
  const proposal = {
    tool: "publish_day",
    arguments: { trip: "a-trip", slug: "tuesday" },
    sentence: "Put this day on the site as your readers will see it.",
    fields: [],
    endpoint: "/api/helper/alex/day/publish",
    method: "POST" as const,
    accept: "Put it on the site",
    done: "It is on the site.",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/day?trip=")) {
        return {
          ok: true,
          json: async () => ({
            preview: {
              day: {
                date: "2026-08-01",
                lead: {
                  slug: "tuesday",
                  title: "Ankunft",
                  date: "2026-08-01",
                  location: "Bellinzona",
                  country: "Switzerland",
                  content: "<p>Words.</p>",
                  gallery: [],
                  costs: [],
                  draft: true,
                },
                entries: [],
              },
              summary: {},
              dayIndex: 0,
            },
          }),
        } as Response;
      }
      if (url.endsWith("/proposal")) {
        return {
          ok: true,
          json: async () => ({
            blocks: [{ shape: "confirm", text: proposal.sentence, fields: [], proposal }],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );

  const box = render({ trip: "a-trip", slug: "tuesday" });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // The label says what the button does — a card to review, not a write —
  // and is not the chip suggestion's own wording (`agent.about.publish`),
  // since that string is arguably correct for the chip and would be false
  // here.
  const previewSection = box.querySelector('section[aria-label="Preview"]')!;
  const header = [...previewSection.querySelectorAll("button")].find(
    (button) => button.textContent === dictionary["agent.room.reviewToPublish"],
  ) as HTMLButtonElement;
  expect(header).toBeDefined();
  expect(header.textContent).not.toBe(dictionary["agent.about.publish"]);

  await act(async () => {
    header.click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const chat = box.querySelector(`section[aria-label="${dictionary["agent.chat.title"]}"]`)!;
  expect(chat.textContent).toContain(proposal.sentence);
});

/**
 * B1275's other half — pressing that card's own button publishes, and the
 * preview shows it without a reload. `accept()` in `HelperAsk.tsx` already
 * calls `onSubject` with the proposal's own trip and slug on every
 * successful write (B901), and `onSubject` here bumps `subject.at`, which
 * is what the day-fetch effect keys on — the same mechanism the day chips
 * use, reused rather than duplicated for this one tool.
 */
test("pressing the card publishes, and the preview updates with no reload", async () => {
  const proposal = {
    tool: "publish_day",
    arguments: { trip: "a-trip", slug: "tuesday" },
    sentence: "Put this day on the site as your readers will see it.",
    fields: [],
    endpoint: "/api/helper/alex/day/publish",
    method: "POST" as const,
    accept: "Put it on the site",
    done: "It is on the site.",
  };
  let dayReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/day?trip=")) {
        dayReads += 1;
        return {
          ok: true,
          json: async () => ({
            preview: {
              day: {
                date: "2026-08-01",
                lead: {
                  slug: "tuesday",
                  title: "Ankunft",
                  date: "2026-08-01",
                  location: "Bellinzona",
                  country: "Switzerland",
                  content: "<p>Words.</p>",
                  gallery: [],
                  costs: [],
                  // The second read (after the press) answers published.
                  draft: dayReads === 1,
                },
                entries: [],
              },
              summary: {},
              dayIndex: 0,
            },
          }),
        } as Response;
      }
      if (url.endsWith("/proposal")) {
        return {
          ok: true,
          json: async () => ({
            blocks: [{ shape: "confirm", text: proposal.sentence, fields: [], proposal }],
          }),
        } as Response;
      }
      if (url.endsWith("/day/publish")) {
        return { ok: true, json: async () => ({ ok: true, slug: "tuesday" }) } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );

  const box = render({ trip: "a-trip", slug: "tuesday" });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const previewSection = box.querySelector('section[aria-label="Preview"]')!;
  const header = [...previewSection.querySelectorAll("button")].find(
    (button) => button.textContent === dictionary["agent.room.reviewToPublish"],
  ) as HTMLButtonElement;
  await act(async () => {
    header.click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const chat = box.querySelector(`section[aria-label="${dictionary["agent.chat.title"]}"]`)!;
  const press = [...chat.querySelectorAll("button")].find(
    (button) => button.textContent === proposal.accept,
  ) as HTMLButtonElement;
  expect(press).toBeDefined();
  await act(async () => {
    press.click();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(dayReads).toBeGreaterThanOrEqual(2);
  // The header's own control flips from "review to publish" to "see it on
  // the site" — the preview read itself, not a page reload.
  expect(previewSection.textContent).toContain(dictionary["agent.room.openOnSite"]);
});

/**
 * B1257 — the preview pane renders `DayCard` with no `TripProvider` in
 * scope, so `DraftNotice`'s own `useTrip()` read used to fall back to
 * `canPublish: false` and told the owner previewing their own draft that
 * publishing was somebody else's to ask for. The room is owner-only by
 * construction, so the owner's own copy ("Draft — only you can see this")
 * is what belongs here, never the shared reader's ("Draft — not on the site
 * yet").
 */
test("the preview's draft banner speaks to the owner, not a shared reader — B1257", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/day?trip=")) {
        return {
          ok: true,
          json: async () => ({
            preview: {
              day: {
                date: "2026-08-01",
                lead: {
                  slug: "tuesday",
                  title: "Ankunft",
                  date: "2026-08-01",
                  location: "Bellinzona",
                  country: "Switzerland",
                  content: "<p>Words.</p>",
                  gallery: [],
                  costs: [],
                  draft: true,
                },
                entries: [],
              },
              summary: {},
              dayIndex: 0,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ ok: true, blocks: [] }) } as Response;
    }),
  );

  const box = render({ trip: "a-trip", slug: "tuesday" });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const previewSection = box.querySelector('section[aria-label="Preview"]')!;
  expect(previewSection.textContent).toContain(dictionary["draft.title"]);
  expect(previewSection.textContent).not.toContain(dictionary["draft.titleShared"]);
});

/**
 * The strip's own live region — B1016, and the same rule B949 wrote down for
 * the drawer's count: a region created at the same moment as its first
 * content is one a screen reader may never have been watching.
 */
describe("the files strip", () => {
  test("its live region is mounted before anything is picked", () => {
    const box = render();
    // The drawer's own region already does this (B949); this counts at
    // least two empty ones now that the strip has its own — not "is there
    // once something is selected", there, now, empty.
    const empty = [...box.querySelectorAll('[role="status"]')].filter(
      (one) => one.textContent === "",
    );
    expect(empty.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * B1272's third acceptance line, re-checked after B1443 — a live owner
 * session found the pane's own note quoting “What is waiting”, a heading
 * that belongs to the standalone `/agent/<user>/inbox` page and not to this
 * room, whose files pane groups the same wait under "Photographs" and
 * "Documents" (`InboxFileGroups`). The note used `t("agent.pickAnyFile")`
 * directly rather than through `PhotoPicker`'s (then-unwired) `noteKey`.
 *
 * This reads straight from the dictionary rather than hard-coding the
 * expected sentence, so it fails the same way the live check did whenever
 * the note quotes a label the pane does not carry — the bug this ticket
 * exists to close, not merely the sentence this fix happens to write.
 */
test("every quoted label in the files pane's note appears on the pane — B1443", () => {
  // The shared FILES fixture's inbox items carry no `kind`, so they all fall
  // into `InboxFileGroups`' "document" group and the "Photographs" heading
  // never renders at all — a fixture gap that would have hidden this bug
  // rather than catching it. This one carries a photograph and a document,
  // which is what makes both headings — and both quoted labels — real.
  const files: RoomFiles = {
    inbox: [
      { id: "inbox:aaa111-harbour.jpg", name: "harbour.jpg", kind: "media" },
      { id: "inbox:bbb222-statement.csv", name: "statement.csv", kind: "files" },
    ],
    trip: [],
    tripTitle: "A Trip",
  };
  const box = render(null, files);
  const pane = box.querySelector('section[aria-label="Files"]')!;
  const note = dictionary["agent.room.pickAnyFile"];
  // Not just "this string exists somewhere" — this is the sentence the room
  // is actually supposed to render, so a room that still says something else
  // (the standalone page's `agent.pickAnyFile`, say) fails right here.
  expect(pane.textContent).toContain(note);
  const quoted = [...note.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]);
  // The note is supposed to be quoting something; an empty match here would
  // make the rest of this test vacuously true.
  expect(quoted.length).toBeGreaterThan(0);
  const labels = [...pane.querySelectorAll("h2, h3")].map((heading) => heading.textContent?.trim());
  for (const label of quoted) {
    expect(labels).toContain(label);
  }
});

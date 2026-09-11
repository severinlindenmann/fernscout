// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HelperAsk from "@/components/HelperAsk";
import LocaleProvider from "@/components/LocaleProvider";
import type { Block } from "@/lib/helper/blocks";
import { dictionaryFor } from "@/lib/locales";
import { typeInto } from "./support/type-input";

/**
 * The conversation — B899, checklists B and D of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * Same jsdom + `createRoot` harness as `test/tel-field-combobox.test.tsx`,
 * rather than adding `@testing-library/react` for one component.
 *
 * What is asserted is the shape a person works in: turns stay in order and the
 * second does not repeat the first, the field keeps focus after sending,
 * something honest is on the screen while it thinks, a block declared by a
 * tool is drawn and is operable with the keyboard, and starting over reaches
 * the `forget()` that had no caller.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string; method: string; body: Record<string, unknown> }[] = [];

const dictionary = dictionaryFor("en");

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  calls = [];
});

/** Answers the route would give, in order. */
function answers(...bodies: Record<string, unknown>[]) {
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      });
      const body = bodies[Math.min(next, bodies.length - 1)];
      next += 1;
      return { ok: true, json: async () => body } as Response;
    }),
  );
}

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <HelperAsk
          username="alex"
          consented
          speech={false}
          consentedSpeech={false}
          speechProvider="dry-run"
        />
      </LocaleProvider>,
    );
  });
  // Quiet and second, B767: it opens as a line, and becomes a conversation.
  act(() => {
    (container!.querySelector("button") as HTMLButtonElement).click();
  });
}

function field(): HTMLTextAreaElement {
  return container!.querySelector("#ask-alex") as HTMLTextAreaElement;
}

function type(value: string) {
  const el = field();
  act(() => {
    typeInto(el, value);
  });
}

function buttonSaying(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find((one) =>
    (one.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button saying "${text}" in: ${container!.textContent}`);
  return found as HTMLButtonElement;
}

async function ask(said: string) {
  type(said);
  await act(async () => {
    // The send control is icon-only since B1211 (D14): found by its
    // accessible name, which is what a person's screen reader finds too.
    const send = container!.querySelector(
      `button[aria-label="${dictionary["agent.askGo"]}"]`,
    ) as HTMLButtonElement;
    send.click();
  });
}

function saying(text: string): Block[] {
  return [{ shape: "say", text }];
}

/** One turn that ends in a proposal — the shape the route sends since B900:
 *  the block carries the proposal, and the proposal carries where a press
 *  goes. Nothing in it has happened. */
function proposed() {
  const proposal = {
    tool: "create_trip",
    arguments: { title: "Japan", start: "2027-03-01", end: "2027-03-31" },
    sentence: "A trip called Japan.",
    fields: [
      { name: "title", value: "Japan" },
      { name: "start", value: "2027-03-01", date: true },
      { name: "end", value: "2027-03-31", date: true },
      {
        name: "visibility",
        value: "guest",
        options: [
          { value: "public", label: "Public" },
          { value: "guest", label: "Guests" },
          { value: "private", label: "Private" },
        ],
      },
    ],
    endpoint: "/api/helper/alex/trip",
    method: "POST" as const,
    accept: "Make this trip",
    done: "The trip is made.",
  };
  return {
    ok: true,
    kind: "read",
    blocks: [
      { shape: "form", text: proposal.sentence, fields: proposal.fields, proposal },
    ] satisfies Block[],
    proposals: [proposal],
  };
}

describe("turns", () => {
  test("stay in order, and the second does not repeat the first", async () => {
    answers(
      { ok: true, kind: "read", blocks: saying("Two trips.") },
      { ok: true, kind: "read", blocks: saying("Ten days.") },
    );
    render();
    await ask("how many trips");
    await ask("how long");

    const thread = container!.querySelector('[role="log"]')!;
    const text = thread.textContent ?? "";
    expect(text.indexOf("how many trips")).toBeLessThan(text.indexOf("how long"));
    expect(text.indexOf("Two trips.")).toBeLessThan(text.indexOf("Ten days."));
    // Drawn once, not once per turn.
    expect(text.split("Two trips.").length - 1).toBe(1);
  });

  test("are announced once each, not per token", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Hello.") });
    render();
    await ask("hello");
    // Nothing streams here, so one polite live region over the whole thread
    // announces one addition per turn. `assertive` would interrupt, and a
    // live region on each block would announce a turn several times.
    const thread = container!.querySelector('[role="log"]')!;
    expect(thread.getAttribute("aria-live")).toBe("polite");
    expect(thread.getAttribute("aria-relevant")).toBe("additions");
    expect(container!.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

describe("the field", () => {
  test("empties and keeps focus after sending", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Two trips.") });
    render();
    await ask("how many trips");
    expect(field().value).toBe("");
    expect(document.activeElement).toBe(field());
  });

  test("is the last thing in the flow, so a keyboard at 390px scrolls to it", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Two trips.") });
    render();
    await ask("how many trips");
    const thread = container!.querySelector('[role="log"]')!;
    expect(thread.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("while it thinks", () => {
  test("it says so, rather than going quiet", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, json: async () => ({ ok: true, kind: "read", blocks: saying("Two.") }) } as Response;
      }),
    );
    render();
    type("how many trips");
    act(() => {
      (container!.querySelector(
        `button[aria-label="${dictionary["agent.askGo"]}"]`,
      ) as HTMLButtonElement).click();
    });
    expect(container!.textContent).toContain(dictionary["agent.chat.working"]);
    await act(async () => {
      release?.();
    });
    expect(container!.textContent).not.toContain(dictionary["agent.chat.working"]);
  });
});

/**
 * B1213 (D19) — the same wait, said honestly. `askStreamed` in
 * `HelperAsk.tsx` reads the route's NDJSON body line by line; this drives it
 * with a real `ReadableStream` whose chunks are released by hand, the same
 * shape `test/helper-thread.test.ts` proves the server actually writes.
 */
describe("while it thinks, and the server says what it is doing — B1213 (D19)", () => {
  test("a streamed status line replaces the silence, and the answer still lands whole", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            headers: { get: () => "application/x-ndjson" },
            body: stream,
          }) as unknown as Response,
      ),
    );

    render();
    type("how many trips");
    act(() => {
      (container!.querySelector(
        `button[aria-label="${dictionary["agent.askGo"]}"]`,
      ) as HTMLButtonElement).click();
    });

    // Let the mocked fetch resolve and the reader start waiting on a chunk.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      controller!.enqueue(encoder.encode(`${JSON.stringify({ status: "Reading the day…" })}\n`));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container!.textContent).toContain("Reading the day…");

    act(() => {
      controller!.enqueue(
        encoder.encode(
          `${JSON.stringify({ done: { ok: true, kind: "read", blocks: saying("Two.") } })}\n`,
        ),
      );
      controller!.close();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Two.");
    // The status line was the wait, not the answer — it does not linger
    // beside it once the turn has landed.
    expect(container!.textContent).not.toContain("Reading the day…");
  });
});

describe("the blocks a tool declares", () => {
  test("`choose` is a list of buttons, and pressing one fills the field", async () => {
    answers({
      ok: true,
      kind: "read",
      blocks: [
        {
          shape: "choose",
          text: "Trips in this journal",
          options: [
            { value: "japan", label: "Japan", detail: "2026-03-01 – 2026-03-14" },
            { value: "alps", label: "Alps" },
          ],
        },
      ] satisfies Block[],
    });
    render();
    await ask("which trips");
    const option = buttonSaying("Japan");
    expect(option.tagName).toBe("BUTTON");
    act(() => option.click());
    expect(field().value).toBe("Japan");
    expect(document.activeElement).toBe(field());
  });

  test("`preview` draws the thing itself, line by line", async () => {
    answers({
      ok: true,
      kind: "read",
      blocks: [
        { shape: "preview", text: "The day as it stands", lines: ["2026-05-01", "Eins", "Worte."] },
      ] satisfies Block[],
    });
    render();
    await ask("show me the first day");
    expect(container!.textContent).toContain("2026-05-01");
    expect(container!.textContent).toContain("Worte.");
  });

  test("a proposal is drawn with its fields editable, and nothing is written yet", async () => {
    answers(proposed());
    render();
    await ask("make a trip to japan");
    const title = container!.querySelector("input[value=\"Japan\"]") as HTMLInputElement;
    expect(title).not.toBeNull();
    expect(title.disabled).toBe(false);
    // One ask, and nothing else: proposing posts to no route at all.
    expect(calls).toHaveLength(1);
    // Focus moves to the proposal when one appears — B795's lesson, applied
    // before it is a bug rather than after.
    expect((document.activeElement as HTMLElement)?.textContent).toContain("A trip called Japan.");
  });

  test("pressing posts what the proposal says, where it says, edits and all", async () => {
    answers(proposed(), { ok: true, id: "japan-2027" }, { ok: true });
    render();
    await ask("make a trip to japan");

    const title = container!.querySelector("input[value=\"Japan\"]") as HTMLInputElement;
    act(() => {
      typeInto(title, "Japan im Frühling");
    });

    await act(async () => {
      buttonSaying("Make this trip").click();
    });

    expect(calls[1]).toMatchObject({
      url: "/api/helper/alex/trip",
      method: "POST",
      // The arguments the tool proposed, with what the person typed on top.
      body: { title: "Japan im Frühling", start: "2027-03-01", visibility: "guest" },
    });
    // What happened, in their own language — and the conversation says it
    // rather than the page navigating away from itself.
    expect(container!.textContent).toContain("The trip is made.");
    // And the field has focus again, because saying something else is next.
    expect(document.activeElement).toBe(field());
  });

  test("leaving a proposal alone writes nothing and charges nothing", async () => {
    answers(proposed());
    render();
    await ask("make a trip to japan");
    await act(async () => {
      buttonSaying(dictionary["agent.chat.leaveIt"]).click();
    });
    expect(calls).toHaveLength(1);
    expect(container!.textContent).toContain(dictionary["agent.chat.leftIt"]);
  });

  test("and correcting it in words is offered right there", async () => {
    answers(proposed());
    render();
    await ask("make a trip to japan");
    expect(container!.textContent).toContain(dictionary["agent.chat.orSayWhatIsWrong"]);
  });

  test("a confirm has no fields and one button that says what it does", async () => {
    answers({
      ok: true,
      kind: "read",
      blocks: [
        { shape: "preview", text: "", lines: ["2026-05-01", "Der erste Tag"] },
        {
          shape: "confirm",
          text: "Put it on the site?",
          proposal: {
            tool: "publish_day",
            arguments: { trip: "reise", slug: "one" },
            sentence: "Put it on the site?",
            fields: [],
            endpoint: "/api/helper/alex/day/publish",
            method: "POST",
            accept: "Put it on the site",
            done: "It is on the site.",
          },
        },
      ] satisfies Block[],
    });
    render();
    await ask("publish that day");
    // The day is read back first, and then there is one thing to press.
    const text = container!.textContent ?? "";
    expect(text.indexOf("Der erste Tag")).toBeLessThan(text.indexOf("Put it on the site"));
    expect(container!.querySelectorAll('[role="log"] input')).toHaveLength(0);
    expect(buttonSaying("Put it on the site")).toBeTruthy();
  });

  test("a shape nobody has drawn yet still says its sentence", async () => {
    answers({
      ok: true,
      kind: "read",
      blocks: [{ shape: "files", text: "Four photographs", files: [{ id: "a", name: "one.jpg" }] }],
    });
    render();
    await ask("what is in the inbox");
    expect(container!.textContent).toContain("Four photographs");
    expect(container!.textContent).toContain("one.jpg");
  });
});

describe("starting over", () => {
  /** The control left the composer — B1208 (D17): the header's + is the
   *  one way to start fresh (it DELETEs the thread and reloads), and two
   *  adjacent reset controls confused more than they helped. What this
   *  suite still owes is the negative: no second reset control here. */
  test("the composer offers no start-over of its own", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Two trips.") });
    render();
    await ask("how many trips");
    expect(container!.textContent).not.toContain(dictionary["agent.chat.startOver"]);
  });
});

describe("what is deliberately not borrowed", () => {
  test("no avatar, no name, no personality on the screen", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Two trips.") });
    render();
    await ask("how many trips");
    expect(container!.querySelector("img")).toBeNull();
    // The person's own turn is labelled for a screen reader and by nothing
    // else; there is no second name, because nobody is there.
    expect(container!.textContent).not.toMatch(/assistant|helper says|bot/i);
  });
});

/**
 * B915 — a `confirm` draws no fields, so `values` is empty when it is
 * pressed. Until this, the press posted the model's own arguments and the
 * fields the *server* resolved were dropped: a proposal whose preview named
 * "the pass" could post a body with no slug in it at all. What is read back
 * above the button and what the button sends have to be the same day.
 */
describe("what a press actually posts", () => {
  test("a confirm sends the fields the server resolved, not only the model's arguments", async () => {
    answers(
      {
        ok: true,
        kind: "read",
        blocks: [
          {
            shape: "confirm",
            text: "Two photographs onto the pass.",
            proposal: {
              tool: "attach_files",
              // What a press sends — B935: the server's own resolution, not
              // the date-and-no-ids the model asked with.
              arguments: {
                trip: "a-trip",
                date: "2026-05-04",
                slug: "the-pass",
                files: "aaa-one.jpg,bbb-two.jpg",
              },
              sentence: "Two photographs onto the pass.",
              fields: [
                { name: "trip", value: "a-trip" },
                { name: "slug", value: "the-pass" },
                { name: "files", value: "aaa-one.jpg,bbb-two.jpg" },
              ],
              endpoint: "/api/helper/alex/day/attach",
              method: "POST",
              accept: "Put them on the day",
              done: "They are on the day.",
            },
          },
        ] satisfies Block[],
      },
      { ok: true, attached: 2, moved: ["aaa-one.jpg", "bbb-two.jpg"] },
      { ok: true },
    );
    render();
    await ask("put these on yesterday");
    await act(async () => {
      buttonSaying("Put them on the day").click();
    });
    expect(calls[1]).toMatchObject({
      url: "/api/helper/alex/day/attach",
      method: "POST",
      body: { trip: "a-trip", slug: "the-pass", files: "aaa-one.jpg,bbb-two.jpg" },
    });
    expect(container!.textContent).toContain("They are on the day.");
  });
});

/**
 * The truth of a press — B916, B918 and B919, and checklist E of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * `setSettled("accepted")` used to fire before the fetch resolved, so a card
 * said *"The day is started"* and the write then failed; the only trace was a
 * code appended under the log. All three of those are asserted here: nothing
 * is claimed until the route has answered, the refusal is a sentence beside
 * the fields that caused it, and a turn carrying two proposals focuses the
 * one that has to be pressed first.
 */

/** Answers with a status, so a refusal can be driven — `answers()` above is
 *  always `ok`. */
function replies(...bodies: { ok?: boolean; body: Record<string, unknown> }[]) {
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
      });
      const reply = bodies[Math.min(next, bodies.length - 1)];
      next += 1;
      return { ok: reply.ok ?? true, json: async () => reply.body } as Response;
    }),
  );
}

/** `start_day` as the conversation offers it since B917 — the trip's own
 *  questions among the fields, open on "nobody has it". */
function startDay() {
  return {
    tool: "start_day",
    arguments: { trip: "reise", date: "2026-05-04" },
    sentence: "A day for 2026-05-04.",
    fields: [
      { name: "trip", value: "reise" },
      { name: "date", value: "2026-05-04", date: true },
      {
        name: "costs",
        value: "unknown",
        options: [
          { value: "unknown", label: "Nobody has it" },
          { value: "none", label: "There was none" },
        ],
      },
    ],
    endpoint: "/api/helper/alex/day",
    method: "POST" as const,
    accept: "Start this day",
    done: "The day is started.",
  };
}

function turnOf(...proposals: ReturnType<typeof startDay>[]) {
  return {
    ok: true,
    kind: "read",
    blocks: proposals.map((proposal) => ({
      shape: "form",
      text: proposal.sentence,
      fields: proposal.fields,
      proposal,
    })) as Block[],
  };
}

describe("a proposal says a thing was done only after it was done", () => {
  test("a failed press does not claim it worked, and the card stays pressable", async () => {
    replies(
      { body: turnOf(startDay()) },
      { ok: false, body: { error: "incomplete_day", missing: ["costs"] } },
    );
    render();
    await ask("start yesterday");
    await act(async () => {
      buttonSaying("Start this day").click();
    });

    // The claim that was made before the write had happened.
    expect(container!.textContent).not.toContain("The day is started.");
    // The fields are still there, and so is the button.
    expect(container!.querySelector('input[value="2026-05-04"]')).not.toBeNull();
    expect(buttonSaying("Start this day").disabled).toBe(false);
  });

  test("the refusal is a sentence beside the fields, not a code under the log", async () => {
    replies(
      { body: turnOf(startDay()) },
      { ok: false, body: { error: "incomplete_day", missing: ["costs"] } },
    );
    render();
    await ask("start yesterday");
    await act(async () => {
      buttonSaying("Start this day").click();
    });

    const said = container!.querySelector('[role="alert"]') as HTMLElement;
    // B919 — what a person is read is a sentence in their own language.
    expect(said.textContent).toBe(dictionary["agent.error.incomplete_day"]);
    expect(container!.textContent).not.toContain("incomplete_day");
    // Beside the fields it belongs to, and focused — B916.
    expect(said.closest("form, div")?.textContent).toContain("A day for 2026-05-04.");
    expect(document.activeElement).toBe(said);
  });

  test("a press that works still says so, once the route has answered", async () => {
    replies(
      { body: turnOf(startDay()) },
      { body: { ok: true, trip: "reise", slug: "2026-05-04-day" } },
      { body: { ok: true } },
    );
    render();
    await ask("start yesterday");
    await act(async () => {
      buttonSaying("Start this day").click();
    });
    expect(container!.textContent).toContain("The day is started.");
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("a turn with two proposals", () => {
  test("lands focus on the one that must be pressed first", async () => {
    const second = { ...startDay(), tool: "draft_words", sentence: "Words for that day." };
    replies({ body: turnOf(startDay(), second) });
    render();
    await ask("write up yesterday");
    // One ref shared by both used to be assigned in DOM order, so focus went
    // to whichever mounted last and the first was before the focus point.
    expect((document.activeElement as HTMLElement)?.textContent).toContain(
      "A day for 2026-05-04.",
    );
    expect((document.activeElement as HTMLElement)?.textContent).not.toContain(
      "Words for that day.",
    );
  });
});

/**
 * B1253 — the proposal focus and the thread's own bottom-scroll used to be
 * two effects that ran every render and disagreed: the second always undid
 * the first, so a tall card opened scrolled past the sentence explaining it.
 * jsdom has no layout, so this asserts which DOM call fires for which kind
 * of turn rather than any pixel — `scrollIntoView` for a card, the log's
 * `scrollTop` setter for plain text.
 */
describe("where the screen goes when a turn lands — B1253", () => {
  // The log only mounts once a turn exists (`inRoom || turns.length > 0`),
  // so both spies go on the prototype rather than on a queried instance —
  // there is nothing to query yet at the point a real page would already
  // have decided where to scroll.
  let scrollIntoView: ReturnType<typeof vi.fn<() => void>>;
  let scrollTopSpy: ReturnType<typeof vi.fn<(value: number) => void>>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    scrollTopSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollTop", {
      configurable: true,
      get() {
        return 0;
      },
      set(value) {
        scrollTopSpy(value);
      },
    });
  });

  test("a proposal turn scrolls the card into view and leaves the log's own scrollTop alone", async () => {
    answers(proposed());
    render();

    await ask("plan a trip");

    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollTopSpy).not.toHaveBeenCalled();
  });

  test("a plain-text turn scrolls the log to its newest line, not any card", async () => {
    answers({ ok: true, kind: "read", blocks: saying("Two trips.") });
    render();

    await ask("how many trips");

    expect(scrollTopSpy).toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

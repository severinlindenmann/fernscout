// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import HelperAsk from "@/components/HelperAsk";
import LocaleProvider from "@/components/LocaleProvider";
import type { Block } from "@/lib/helper/blocks";
import { dictionaryFor } from "@/lib/locales";

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
let calls: { url: string; method: string }[] = [];

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
    vi.fn(async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? "GET" });
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

function field(): HTMLInputElement {
  return container!.querySelector("#ask-alex") as HTMLInputElement;
}

function type(value: string) {
  const el = field();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
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
    buttonSaying(dictionary["agent.askGo"]).click();
  });
}

function saying(text: string): Block[] {
  return [{ shape: "say", text }];
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
      buttonSaying(dictionary["agent.askGo"]).click();
    });
    expect(container!.textContent).toContain(dictionary["agent.chat.working"]);
    await act(async () => {
      release?.();
    });
    expect(container!.textContent).not.toContain(dictionary["agent.chat.working"]);
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

  test("a proposal is read-only and says nothing has been written", async () => {
    answers({
      ok: true,
      kind: "read",
      blocks: [
        {
          shape: "form",
          text: "A trip called Japan.",
          fields: [{ name: "title", value: "Japan" }],
        },
      ] satisfies Block[],
      proposals: [
        { tool: "new_trip", arguments: { title: "Japan" }, sentence: "A trip called Japan.", fields: [] },
      ],
    });
    render();
    await ask("make a trip to japan");
    expect(container!.textContent).toContain(dictionary["agent.chat.readOnly"]);
    // Focus moves to the proposal when one appears — B795's lesson, applied
    // before it is a bug rather than after.
    expect((document.activeElement as HTMLElement)?.textContent).toContain("A trip called Japan.");
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
  test("reaches `forget()` and clears what is on the screen", async () => {
    answers(
      { ok: true, kind: "read", blocks: saying("Two trips.") },
      { ok: true },
    );
    render();
    await ask("how many trips");
    await act(async () => {
      buttonSaying(dictionary["agent.chat.startOver"]).click();
    });
    expect(calls[1]).toEqual({ url: "/api/helper/alex/ask", method: "DELETE" });
    expect(container!.textContent).not.toContain("Two trips.");
    expect(container!.textContent).toContain(dictionary["agent.chat.startedOver"]);
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

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
 * B1391 — a genuine second press for what cannot be undone.
 *
 * A bare "löschen" typed as a reply to the helper's own delete question used
 * to be refused before a model ever read it (`refusalFor` in
 * `lib/helper/intents.ts`), because a destruction word with nothing named
 * alongside it cannot be told apart from "delete my whole journal". Rather
 * than teach that pre-model guard to read the conversation for context, the
 * confirmation moves off free text: a `destroy`-kind card's first press now
 * swaps the accept row for a `ConfirmPanel`, in place, and only the second
 * press writes — nobody has to type a confirmation sentence at all.
 * `unpublish_day` is the one `destroy`-named exception, since it only
 * changes `status:` and the day stays on disk.
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
  act(() => {
    (container!.querySelector("button") as HTMLButtonElement).click();
  });
}

function field(): HTMLTextAreaElement {
  return container!.querySelector("#ask-alex") as HTMLTextAreaElement;
}

function type(value: string) {
  act(() => typeInto(field(), value));
}

function buttonSaying(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find((one) =>
    (one.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button saying "${text}" in: ${container!.textContent}`);
  return found as HTMLButtonElement;
}

function buttonExists(text: string): boolean {
  return Array.from(container!.querySelectorAll("button")).some((one) =>
    (one.textContent ?? "").includes(text),
  );
}

async function ask(said: string) {
  type(said);
  await act(async () => {
    (
      container!.querySelector(
        `button[aria-label="${dictionary["agent.askGo"]}"]`,
      ) as HTMLButtonElement
    ).click();
  });
}

function saying(text: string): Block[] {
  return [{ shape: "say", text }];
}

function discardFileProposal() {
  const proposal = {
    tool: "discard_file",
    arguments: { file: "abc123" },
    sentence: 'The file waiting in the inbox: "photo.jpg". It leaves the inbox for good.',
    fields: [{ name: "file", value: "abc123", fixed: true as const }],
    endpoint: "/api/helper/alex/inbox/discard",
    method: "POST" as const,
    accept: "Throw it away",
    done: "It is gone from the inbox.",
  };
  return {
    ok: true,
    kind: "read",
    blocks: [{ shape: "confirm", text: proposal.sentence, fields: [], proposal }] satisfies Block[],
  };
}

function unpublishDayProposal() {
  const proposal = {
    tool: "unpublish_day",
    arguments: { trip: "reise", slug: "one" },
    sentence: "Take the ferry day off the site.",
    fields: [{ name: "trip", value: "reise", fixed: true as const }],
    endpoint: "/api/helper/alex/day/unpublish",
    method: "POST" as const,
    accept: "Take it off the site",
    done: "It is off the site.",
  };
  return {
    ok: true,
    kind: "read",
    blocks: [{ shape: "confirm", text: proposal.sentence, fields: [], proposal }] satisfies Block[],
  };
}

describe("a destroy-kind proposal", () => {
  test("does not write on the first press — it asks a second time, in place", async () => {
    replies({ body: discardFileProposal() });
    render();
    await ask("throw away that file");

    await act(async () => {
      buttonSaying("Throw it away").click();
    });

    // No write posted yet — only the read that produced the proposal.
    expect(calls.filter((one) => one.method === "POST" && one.url.includes("discard"))).toHaveLength(0);
    // The confirmation is real: a "there is no undo" sentence and its own
    // confirm/cancel pair, not the plain accept row any more.
    expect(container!.textContent).toContain(dictionary["agent.card.confirmDestroy"]);
    expect(buttonExists(dictionary["me.cancel"])).toBe(true);
  });

  test("writes on the second press, not before", async () => {
    replies(
      { body: discardFileProposal() },
      { body: { ok: true, id: "abc123", filename: "photo.jpg" } },
    );
    render();
    await ask("throw away that file");
    await act(async () => {
      buttonSaying("Throw it away").click();
    });

    // Same label appears twice now — once as the dialog's own title/aria,
    // once as its confirm button — `buttonSaying` finds the pressable one.
    await act(async () => {
      buttonSaying("Throw it away").click();
    });

    expect(calls.filter((one) => one.method === "POST" && one.url.includes("discard"))).toHaveLength(1);
    expect(container!.textContent).toContain("It is gone from the inbox.");
  });

  test("cancelling the second step returns to the ordinary row, and writes nothing", async () => {
    replies({ body: discardFileProposal() });
    render();
    await ask("throw away that file");
    await act(async () => {
      buttonSaying("Throw it away").click();
    });
    await act(async () => {
      buttonSaying(dictionary["me.cancel"]).click();
    });

    expect(container!.textContent).not.toContain(dictionary["agent.card.confirmDestroy"]);
    expect(buttonExists("Throw it away")).toBe(true);
    expect(calls.filter((one) => one.method === "POST" && one.url.includes("discard"))).toHaveLength(0);
  });
});

describe("unpublish_day, the one destroy-named exception", () => {
  test("still writes on a single press — the day stays on disk as a draft", async () => {
    replies(
      { body: unpublishDayProposal() },
      { body: { ok: true } },
    );
    render();
    await ask("take that day off the site");
    await act(async () => {
      buttonSaying("Take it off the site").click();
    });

    expect(calls.filter((one) => one.method === "POST" && one.url.includes("unpublish"))).toHaveLength(1);
    expect(container!.textContent).not.toContain(dictionary["agent.card.confirmDestroy"]);
    expect(container!.textContent).toContain("It is off the site.");
  });
});

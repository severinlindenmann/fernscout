// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import HelperAsk from "@/components/HelperAsk";
import LocaleProvider from "@/components/LocaleProvider";
import type { Block } from "@/lib/helper/blocks";
import { dictionaryFor } from "@/lib/locales";
import { typeInto } from "./support/type-input";

/**
 * A press carries its arguments whatever the verb — B1104.
 *
 * `HelperAsk`'s `send()` read `body: method === "POST" ? … : undefined`, so a
 * PATCH press sent `content-type: application/json` and no JSON. Every route
 * on the other side does `await request.json()`, which threw, so the answer
 * was `invalid_json` and the person was told *"Something in that press did
 * not arrive properly"* about a card that was entirely correct.
 *
 * It was live from B898 and reached `set_day_words` — **writing the words of
 * a day**, which is the most-used write in this product — plus all four of
 * B1078's trip tools. It was found by pressing one on the real site, not by
 * any test here.
 *
 * ## Why nothing caught it, which is the part worth keeping
 *
 * Two habits, each reasonable alone:
 *
 * - Every other press test calls a **route handler directly**, with a body it
 *   built itself. Those prove the server; none of them go through the fetch
 *   in the component, which is where the bug was.
 * - `test/helper-chat.test.tsx`'s own stub records
 *   `init?.body ? JSON.parse(init.body) : {}` — a missing body becomes an
 *   empty object and every assertion about "what was sent" still passes.
 *   The harness papered over the exact defect it was in a position to catch.
 *
 * So this file asserts the one thing neither could: that `init.body` is
 * **present**, for a verb that is not POST.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let calls: { url: string; method: string; rawBody: string | undefined }[] = [];

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

/**
 * Records the **raw** body rather than a parsed one, deliberately. Parsing it
 * here is what hid this for a fortnight.
 */
function answers(...bodies: Record<string, unknown>[]) {
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET", rawBody: init?.body });
      const body = bodies[Math.min(next, bodies.length - 1)];
      next += 1;
      return { ok: true, json: async () => body } as Response;
    }),
  );
}

/** A turn ending in a PATCH proposal — `edit_trip`'s shape, B1078. */
function proposedPatch() {
  const proposal = {
    tool: "edit_trip",
    arguments: { trip: "reise", title: "Islandreise" },
    sentence: "Rename the trip.",
    fields: [
      { name: "trip", value: "reise" },
      { name: "title", value: "Islandreise" },
    ],
    endpoint: "/api/helper/alex/trip",
    method: "PATCH" as const,
    accept: "Save these changes",
    done: "Saved.",
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

function buttonSaying(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find((one) =>
    (one.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button saying "${text}" in: ${container!.textContent}`);
  return found as HTMLButtonElement;
}

async function ask(said: string) {
  const el = container!.querySelector("#ask-alex") as HTMLInputElement;
  act(() => {
    typeInto(el, said);
  });
  await act(async () => {
    buttonSaying(dictionary["agent.askGo"]).click();
  });
}

test("a PATCH press sends its arguments, not an empty request", async () => {
  answers(proposedPatch(), { ok: true });
  render();
  await ask("rename the trip to Islandreise");
  await act(async () => {
    buttonSaying("Save these changes").click();
  });

  const press = calls.find((one) => one.method === "PATCH");
  expect(press, "no PATCH was sent at all").toBeTruthy();

  // The whole bug, in one assertion: this was `undefined`.
  expect(press!.rawBody, "a PATCH press sent no body").toBeTypeOf("string");
  expect(JSON.parse(press!.rawBody!)).toMatchObject({
    trip: "reise",
    title: "Islandreise",
  });
});

test("and the content-type never promises a body that is not there", async () => {
  answers(proposedPatch(), { ok: true });
  render();
  await ask("rename the trip to Islandreise");
  await act(async () => {
    buttonSaying("Save these changes").click();
  });

  // A route that is told the body is JSON and handed nothing answers
  // `invalid_json`, which reads to a person as "your press was malformed"
  // rather than "this software forgot to send it". Either both or neither.
  for (const call of calls) {
    if (call.method === "GET") continue;
    expect(call.rawBody, `${call.method} ${call.url} sent no body`).toBeTypeOf("string");
  }
});

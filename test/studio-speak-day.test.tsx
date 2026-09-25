// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { currentSearch, resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));
// The microphone itself is RecordButton's own business (its own tests); here
// a press hands back whatever the test says was heard.
vi.mock("@/components/RecordButton", () => ({
  default: ({ onText }: { onText: (said: string) => void }) => (
    <button type="button" data-fake-mic onClick={() => onText((globalThis as { heard?: string }).heard ?? "")}>
      mic
    </button>
  ),
}));

/**
 * B2194 — a day by voice. "How do you like to tell it?" is asked once, only
 * with transcription on; the spoken questions assemble exactly the person's
 * corrected answers, skips left out, no question text; reading aloud exists
 * only where the browser has a voice; and the save is the composer's own POST.
 */

const { default: AddDayFlow } = await import("@/components/studio/day/AddDayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

const TODAY = "2025-11-10";
const SPEECH = { consented: true, provider: "dry-run", credits: 3, priceChf: "CHF 0.01" };
const en = dictionaryFor("en");

let root: Root | undefined;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: Record<string, unknown> }[];
let props: Record<string, unknown>;
let inbox: Record<string, unknown>[];

beforeEach(() => {
  calls = [];
  props = {};
  inbox = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") calls.push({ url, method, body: JSON.parse(String(init?.body ?? "{}")) });
      if (url.endsWith("/inbox")) return Response.json({ media: inbox });
      if (url.includes("/day/new")) return Response.json({ ok: true, slug: `${TODAY}-a-day` }, { status: 201 });
      return Response.json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={en} locale="en">
        <StudioBarProvider username="alex">
          <AddDayFlow
            username="alex"
            trips={[{ id: "reise", title: "Reise", start: "2025-11-01", end: "2025-11-30" }]}
            writtenDatesByTrip={{ reise: ["2025-11-02"] }}
            proposal={{ trip: { id: "reise", title: "Reise", status: "current" }, reasonKey: "studio.day.which.reasonCurrent", today: TODAY }}
            {...props}
          />
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await flush();
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}
function button(label: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button ${JSON.stringify(label)} in: ${document.body.textContent}`);
  return b;
}
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}
async function say(words: string) {
  (globalThis as { heard?: string }).heard = words;
  await click(container.querySelector<HTMLElement>("[data-fake-mic]")!);
}
async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const heading = () => container.querySelector("h2")?.textContent ?? "";
const text = () => container.textContent ?? "";

describe("How do you like to tell it? — B2194", () => {
  test("asked once with transcription on; choosing Speak is remembered and opens the first question", async () => {
    props = { speech: SPEECH, tellBy: null };
    await mount();
    expect(heading()).toBe(en["studio.day.tellBy.heading"]);
    expect(container.querySelectorAll("[data-tell-by]")).toHaveLength(3);
    await click(container.querySelector<HTMLElement>('[data-tell-by="speak"]')!);
    expect(calls).toEqual([{ url: "/api/web/alex/studio/tell-by", method: "PATCH", body: { tellBy: "speak" } }]);
    expect(heading()).toBe(en["studio.day.speak.q.how"]);
  });

  test("once answered it is not asked again: Type opens the composer", async () => {
    props = { speech: SPEECH, tellBy: "type" };
    await mount();
    expect(container.querySelector("[data-tell-by]")).toBeNull();
    expect(container.querySelector("#studio-day-words")).not.toBeNull();
  });

  test("with transcription off, neither the question nor the spoken questions exist", async () => {
    props = { speech: null, tellBy: "speak" };
    await mount();
    expect(container.querySelector("[data-tell-by]")).toBeNull();
    expect(text()).not.toContain(en["studio.day.speak.q.how"]);
    expect(container.querySelector("#studio-day-words")).not.toBeNull();
  });
});

describe("a day by voice — B2194", () => {
  test("three spoken answers (one corrected), two skipped: the day is exactly those words, then the composer's own save", async () => {
    props = { speech: SPEECH, tellBy: "speak" };
    await mount();

    expect(heading()).toBe(en["studio.day.speak.q.how"]);
    expect(text()).toContain("0.05 credit a minute");
    await say("Tired but hapy.");
    const box = () => container.querySelector<HTMLTextAreaElement>("#studio-speak-answer")!;
    expect(box().value).toBe("Tired but hapy.");
    await type(box(), "Tired but happy.");
    await click(button(en["studio.day.speak.next"]));

    expect(heading()).toBe(en["studio.day.speak.q.did"]);
    await click(button(en["studio.day.speak.skip"]));

    expect(heading()).toBe(en["studio.day.speak.q.ate"]);
    await say("Pastéis de nata.");
    await click(button(en["studio.day.speak.next"]));

    expect(heading()).toBe(en["studio.day.speak.q.met"]);
    await click(button(en["studio.day.speak.skip"]));

    expect(heading()).toBe(en["studio.day.speak.q.funny"]);
    await say("A seagull stole my bread.");
    await click(button(en["studio.day.speak.finish"]));

    const words = container.querySelector<HTMLTextAreaElement>("#studio-day-words")!;
    expect(words.value).toBe("Tired but happy.\n\nPastéis de nata.\n\nA seagull stole my bread.");
    expect(currentSearch()).toBe("mode=type");
    // Nothing was written while speaking; the one write is the usual Save.
    expect(calls).toEqual([]);
    await click(button(en["studio.day.save"]));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/helper/alex/day/new");
    expect(calls[0].body.content).toBe("Tired but happy.\n\nPastéis de nata.\n\nA seagull stole my bread.");
  });

  test("a hub day card's photographs (?photos=) are the ones question 2 cites, and they ride into the composer", async () => {
    const at = (id: string, day: string, location: string) => ({ id, filename: `${id}.jpg`, bytes: 1, uploadedAt: `${day}T10:00:00.000Z`, takenAt: `${day}T09:00:00`, location });
    inbox = [at("a", "2025-11-08", "Porto"), at("b", "2025-11-08", "Porto"), at("c", "2025-11-09", "Braga")];
    props = { speech: SPEECH, tellBy: "speak", initialPhotos: "2025-11-08" };
    resetNavigation("photos=2025-11-08");
    await mount();
    await click(button(en["studio.day.speak.skip"]));
    expect(heading()).toBe("2 of your photos are from Porto. What did you do there?");
    for (let i = 0; i < 4; i++) await click(button(en["studio.day.speak.skip"]));
    expect(currentSearch()).toBe("photos=2025-11-08&mode=type");
    await click(button(en["studio.day.save"]));
    expect(calls.at(-1)!.body.mediaInboxIds).toEqual(["a", "b"]);
  });

  test("I'd rather type leaves for the composer with nothing added", async () => {
    props = { speech: SPEECH, tellBy: "speak" };
    await mount();
    await click(button(en["studio.day.speak.type"]));
    expect(container.querySelector<HTMLTextAreaElement>("#studio-day-words")!.value).toBe("");
  });

  test("Read it aloud exists only where the browser has a voice, and speaks the question in the page's language", async () => {
    props = { speech: SPEECH, tellBy: "speak" };
    await mount();
    expect(container.querySelector("[data-read-aloud]")).toBeNull();
    act(() => root!.unmount());
    container.remove();

    const spoken: { text: string; lang: string }[] = [];
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        lang = "";
        constructor(public text: string) {}
      },
    );
    (window as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: () => {},
      speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }),
    };
    await mount();
    await click(container.querySelector<HTMLElement>("[data-read-aloud]")!);
    expect(spoken).toEqual([{ text: en["studio.day.speak.q.how"], lang: "en" }]);
  });

  test("with an insufficient balance the price line goes quiet — B2234", async () => {
    props = { speech: { ...SPEECH, credits: 0 }, tellBy: "speak" };
    await mount();
    expect(text()).not.toContain("credit a minute");
  });

  // B2288 — `priceChf` is computed server-side (pricing is paid-only code
  // after the open-core split); `null` (a public build) shows the credit
  // price alone rather than a wrong CHF 0.00.
  test("with priceChf null the price line shows no CHF — B2288", async () => {
    props = { speech: { ...SPEECH, priceChf: null }, tellBy: "speak" };
    await mount();
    expect(text()).toContain("0.05 credit a minute");
    expect(text()).not.toContain("CHF");
  });
});

describe("Rather talk? — B2236", () => {
  test("shown near the text box once the answer isn't Speak", async () => {
    props = { speech: SPEECH, tellBy: "type" };
    await mount();
    expect(container.querySelector("[data-rather-talk]")).not.toBeNull();
    expect(text()).toContain(en["studio.day.speak.ratherTalk"]);
  });

  test("absent while the spoken questions are already showing", async () => {
    props = { speech: SPEECH, tellBy: "speak" };
    await mount();
    expect(container.querySelector("[data-rather-talk]")).toBeNull();
  });

  test("absent with transcription off", async () => {
    props = { speech: null, tellBy: null };
    await mount();
    expect(container.querySelector("[data-rather-talk]")).toBeNull();
  });

  test("tapping it opens the spoken questions at ?mode=speak and remembers the choice", async () => {
    props = { speech: SPEECH, tellBy: "type" };
    await mount();
    await click(container.querySelector<HTMLElement>("[data-rather-talk]")!);
    expect(currentSearch()).toContain("mode=speak");
    expect(calls).toContainEqual({ url: "/api/web/alex/studio/tell-by", method: "PATCH", body: { tellBy: "speak" } });
    expect(heading()).toBe(en["studio.day.speak.q.how"]);
  });
});

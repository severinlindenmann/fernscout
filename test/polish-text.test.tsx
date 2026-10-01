// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `PolishText` — B2190. A mocked fetch, the same pattern
 * `test/add-day-error-messages.test.tsx` uses for the sibling "draft from
 * notes" assist: nothing here reaches a network, and what a model would say
 * is not this component's business — only that a tap calls the endpoint with
 * `mode: "polish"`, the preview never overwrites without "Use this", and
 * every error code from the route reads as a sentence.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { default: PolishText } = await import("@/components/studio/day/PolishText");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

const LONG_TEXT = "rain all morning then port at grahams and a long walk back to the hotel after dinner";

let root: Root | undefined;
let container: HTMLDivElement;
let writeDayResponse: () => Response | Promise<Response>;
let lastBody: Record<string, unknown> | undefined;

beforeEach(() => {
  lastBody = undefined;
  writeDayResponse = () => Response.json({ ok: true, draft: { title: "", prose: "Tidied prose." } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/day/write-day") && init?.method === "POST") {
        lastBody = JSON.parse(String(init.body));
        return writeDayResponse();
      }
      return Response.json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

function tree(props: Partial<React.ComponentProps<typeof PolishText>> = {}) {
  return (
    <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
      <PolishText
        username="alex"
        trip="reise"
        text={LONG_TEXT}
        onUse={props.onUse ?? (() => {})}
        aiAvailable={"aiAvailable" in props ? (props.aiAvailable ?? null) : true}
        {...props}
      />
    </LocaleProvider>
  );
}

async function mount(props: Partial<React.ComponentProps<typeof PolishText>> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(tree(props)));
  await flush();
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button ${JSON.stringify(text)} in: ${container.textContent}`);
  return b;
}

async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}

describe("visibility", () => {
  test("renders nothing when the text is under 12 words", async () => {
    await mount({ text: "a short day" });
    expect(container.textContent).toBe("");
  });

  test("renders nothing when aiAvailable is null", async () => {
    await mount({ aiAvailable: null });
    expect(container.textContent).toBe("");
  });

  test("shows the link once there is enough text", async () => {
    await mount();
    expect(container.textContent).toContain("Polish my text");
  });

  // B2591 — the plan is checked before the tap, not after a refused fetch:
  // no button, no fetch, just the notice and a way out.
  test("no AI days left shows a notice instead of the tap", async () => {
    await mount({ aiAvailable: false });
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Your AI days for this plan are used up.");
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === "See plans");
    expect(link?.getAttribute("href")).toBe("/@alex/studio/account");
  });
});

describe("the tap", () => {
  test("calls write-day with mode: polish and the owner's own text", async () => {
    await mount();
    await click("Polish my text");
    expect(lastBody).toMatchObject({ trip: "reise", notes: LONG_TEXT, mode: "polish" });
  });

  test("shows a side-by-side preview and never overwrites without a tap", async () => {
    const onUse = vi.fn();
    await mount({ onUse });
    await click("Polish my text");
    expect(container.textContent).toContain("Your words");
    expect(container.textContent).toContain("Polished");
    expect(container.textContent).toContain("Tidied prose.");
    expect(onUse).not.toHaveBeenCalled();
  });

  test("Use this calls onUse with the polished text", async () => {
    const onUse = vi.fn();
    await mount({ onUse });
    await click("Polish my text");
    await click("Use this");
    expect(onUse).toHaveBeenCalledWith("Tidied prose.");
  });

  test("Keep mine discards the preview without calling onUse", async () => {
    const onUse = vi.fn();
    await mount({ onUse });
    await click("Polish my text");
    await click("Keep mine");
    expect(onUse).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Tidied prose.");
  });
});

describe("errors", () => {
  test("polish_added_facts reads as the specific sentence", async () => {
    writeDayResponse = () => Response.json({ error: "polish_added_facts" }, { status: 422 });
    await mount();
    await click("Polish my text");
    expect(container.textContent).toContain("That polish added something you didn't write, so it was not used.");
  });

  test("notes_too_long reads as its own sentence, with the cap", async () => {
    writeDayResponse = () => Response.json({ error: "notes_too_long", maxChars: 12000 }, { status: 413 });
    await mount();
    await click("Polish my text");
    expect(container.textContent).toContain("That's more than 12000 characters — the most one polish takes.");
  });

  test("plan_limit reads as its own sentence", async () => {
    writeDayResponse = () => Response.json({ error: "plan_limit" }, { status: 402 });
    await mount();
    await click("Polish my text");
    expect(container.textContent).toContain("Your AI days for this plan are used up.");
  });

  test("plan_limit offers a way out to the account page", async () => {
    writeDayResponse = () => Response.json({ error: "plan_limit" }, { status: 402 });
    await mount();
    await click("Polish my text");
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.trim() === "See plans");
    expect(link).toBeDefined();
    expect(link?.getAttribute("href")).toBe("/@alex/studio/account");
  });

  test("no other error code offers the credits link", async () => {
    writeDayResponse = () => Response.json({ error: "model_failed" }, { status: 502 });
    await mount();
    await click("Polish my text");
    expect(container.querySelector("a")).toBeNull();
  });

  // B2188 moved the draft box's error keeper (add-day-error-messages, B2184)
  // here: every code write-day answers with keeps a sentence of its own.
  for (const c of [
    { code: "model_failed", status: 502, contains: "nothing was charged" },
    { code: "too_many_requests", status: 429, contains: "Wait a few minutes" },
    { code: "helper_unavailable", status: 404, contains: "isn't turned on" },
    { code: "consent_required", status: 403, contains: "consent" },
    { code: "no_notes", status: 400, contains: "nothing to polish yet" },
  ]) {
    test(`${c.code} reads as its own sentence`, async () => {
      writeDayResponse = () => Response.json({ error: c.code }, { status: c.status });
      await mount();
      await click("Polish my text");
      expect(container.textContent).toContain(c.contains);
    });
  }

  test("a dropped connection reads as something rather than nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await mount();
    await click("Polish my text");
    expect(container.textContent).toContain("That could not be polished. Your own words are still right here.");
  });
});

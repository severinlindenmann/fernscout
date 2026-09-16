// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ExtractFlow from "@/components/extract/ExtractFlow";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1797's own acceptance line: "A new run created through the UI carries the
 * person's real `tripId` and `mode` rather than the defaults — assert on the
 * manifest, not on the screen." This asserts on what `POST .../extract/start`
 * actually received — the same thing a manifest read back would show, since
 * the route writes the body verbatim (`app/api/helper/[user]/extract/start/
 * route.ts`).
 *
 * Before this ticket `ExtractFlow` called `start()` the instant `checkResume`
 * found no live run, with an empty `{}` body — every run was a new trip in
 * typing mode, silently. Now a fresh visit meets Step 01 and Step 02 first,
 * and `start()` is called only once those are answered.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function stubFetch(calls: { url: string; body: unknown }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/extract/runs")) {
        return { ok: true, json: async () => ({ runs: [] }) } as Response;
      }
      if (url.includes("/extract/start")) {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return {
          ok: true,
          json: async () => ({ runId: "run-1", expiresAt: "2099-01-01T00:00:00.000Z" }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function mount(consentedSpeech: boolean) {
  const calls: { url: string; body: unknown }[] = [];
  stubFetch(calls);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <ExtractFlow
          username="alex"
          consentedSpeech={consentedSpeech}
          speechProvider="none"
          trips={[
            { id: "asia-2019", title: "Asia", year: "2019" },
            { id: "peru-2022", title: "Peru", year: "2022" },
          ]}
        />
      </LocaleProvider>,
    );
  });
  // Let checkResume's GET .../extract/runs resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return calls;
}

function clickByText(text: string) {
  const el = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
  if (!el) throw new Error(`no button with text "${text}"`);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ExtractFlow asks before it starts a fresh run", () => {
  test("with no transcription, the mode screen is skipped and 'type' is sent", async () => {
    const calls = await mount(false);

    // Step 01.
    clickByText("Start with my photographs");
    await act(async () => {});

    // Step 02, trip screen only — no mode screen since consentedSpeech is
    // false. Pick the existing trip.
    clickByText("Add to a trip you have");
    await act(async () => {});
    clickByText("Asia");
    await act(async () => {});
    clickByText("Next: choose photographs");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ tripId: "asia-2019", mode: "type" });
  });

  test("with transcription on, both screens show and the chosen mode is sent", async () => {
    const calls = await mount(true);

    clickByText("Start with my photographs");
    await act(async () => {});

    // Leave "Start a new trip" selected (the default) and move to the mode
    // screen.
    clickByText("Next: how you'll tell it");
    await act(async () => {});

    clickByText("Type it");
    await act(async () => {});
    clickByText("Next: choose photographs");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ tripId: null, mode: "type" });
  });

  test("leaving 'talk it through' selected sends voice mode and the default language", async () => {
    const calls = await mount(true);

    clickByText("Start with my photographs");
    await act(async () => {});
    clickByText("Next: how you'll tell it");
    await act(async () => {});
    // "Talk it through" is selected by default — just submit. `ExtractFlow`
    // was mounted with no `defaultSpeechLanguage` prop, so its own "en"
    // default is what the language question preselects (B1803 Task 4.1).
    clickByText("Next: choose photographs");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ tripId: null, mode: "voice", language: "en" });
  });

  test("choosing a different language on the mode screen sends that one", async () => {
    const calls = await mount(true);

    clickByText("Start with my photographs");
    await act(async () => {});
    clickByText("Next: how you'll tell it");
    await act(async () => {});
    // "Talk it through" stays selected; pick Hungarian instead of the
    // preselected "en" — B1803 Task 4.1's "let the person change it".
    clickByText("Magyar");
    await act(async () => {});
    clickByText("Next: choose photographs");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ tripId: null, mode: "voice", language: "hu" });
  });

  test("switching to 'type it' drops the language question and sends none", async () => {
    const calls = await mount(true);

    clickByText("Start with my photographs");
    await act(async () => {});
    clickByText("Next: how you'll tell it");
    await act(async () => {});
    clickByText("Type it");
    await act(async () => {});

    expect(container!.textContent).not.toContain("Which language will you speak?");

    clickByText("Next: choose photographs");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ tripId: null, mode: "type" });
  });
});

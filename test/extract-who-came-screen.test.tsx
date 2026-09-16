// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WhoCameScreen from "@/components/extract/WhoCameScreen";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * S8a's own screen, rendered — B1803 Task 3.6.
 *
 * The one thing a grep of `suggestCompanion` cannot show: that the screen
 * actually surfaces its suggestion only when there is a real one to
 * surface, and says nothing at all — no placeholder, no invented name —
 * when there isn't one.
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

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days: [],
    ...overrides,
  };
}

function stub(manifest: Record<string, unknown>, patchSpy?: (body: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/extract/run")) {
        return { ok: true, json: async () => ({ manifest, groups: [], questions: {} }) } as Response;
      }
      if (url.includes("/extract/party")) {
        patchSpy?.(init?.body ? JSON.parse(String(init.body)) : null);
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <WhoCameScreen username="alex" runId="run-1" onDone={() => {}} />
      </LocaleProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WhoCameScreen", () => {
  test("suggests a name the person actually mentioned twice, with the real days they mentioned it", async () => {
    stub(
      baseManifest({
        days: [
          { date: "2026-06-02", answered: [], words: "We had breakfast with Nora before the market." },
          { date: "2026-06-04", answered: [], words: "Nora wanted to see the temple again." },
        ],
      }),
    );
    await render();

    expect(container!.textContent).toContain("Nora");
    expect(container!.textContent).toContain("Tuesday");
    expect(container!.textContent).toContain("Thursday");
  });

  test("shows nothing at all when nothing in the answers is a clear candidate — no placeholder, no invented name", async () => {
    stub(baseManifest({ days: [{ date: "2026-06-02", answered: [], words: "Quiet day at the beach." }] }));
    await render();

    expect(container!.textContent).not.toMatch(/mentioned/i);
  });

  test("saving sends the stepper count and the typed names to the party route, not the trip's people list", async () => {
    let sent: unknown = null;
    stub(baseManifest(), (body) => {
      sent = body;
    });
    await render();

    const secondInput = container!.querySelectorAll("input")[1] as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(secondInput, "Nora");
      secondInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const save = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Save who came")!;
    await act(async () => {
      save.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sent).toMatchObject({ run: "run-1", size: 2, names: ["alex", "Nora"] });
  });
});

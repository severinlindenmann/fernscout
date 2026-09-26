// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import NotifyStep from "@/components/studio/readers/NotifyStep";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2368 — "Not enough credits — you have 0. Nothing was charged." showed the
 * moment the step loaded, before the owner pressed anything, because the
 * default channel can already cost more than the balance. That borrowed the
 * post-attempt error string, which claims a charge was attempted. Nothing
 * has been tried yet at load time, so the pre-send warning must say so
 * without that claim.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dict = dictionaryFor("en");

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

async function mount(options: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => options }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dict}>
        <NotifyStep username="alex" contactId="c-1" />
      </LocaleProvider>,
    );
  });
}

describe("Add a person, step 2: how they hear about it", () => {
  test("a balance too low for the default channel warns without claiming a charge was attempted", async () => {
    await mount({
      name: "Otto",
      url: "https://example.test/w/abc",
      to: { email: "otto@example.test", mobile: null },
      channels: [{ channel: "sms", cost: 1, blocked: null, preview: "…" }],
      balance: 0,
      creditPrice: "CHF 0.20",
      opened: false,
    });
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
      dict["notifyStep.insufficientBalance"].replace("{balance}", "0"),
    );
    expect(container!.textContent).not.toContain(dict["notifyStep.error.noCredits"].replace("{balance}", "0"));
    // Nothing was posted — this is a load-time warning, not a failed send.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  test("a balance covering the default channel shows nothing about credits being short", async () => {
    await mount({
      name: "Otto",
      url: "https://example.test/w/abc",
      to: { email: "otto@example.test", mobile: null },
      channels: [{ channel: "sms", cost: 1, blocked: null, preview: "…" }],
      balance: 5,
      creditPrice: "CHF 0.20",
      opened: false,
    });
    expect(container!.querySelector('[role="alert"]')).toBeNull();
  });
});

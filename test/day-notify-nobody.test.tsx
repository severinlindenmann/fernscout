// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import DayNotify from "@/components/DayNotify";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1027 — a journal with a channel switched on and nobody subscribed used to
 * still open the send confirmation, letting the owner press a button that
 * reached nobody and reported success. `reachable` only asks whether a
 * channel is configured, not whether anybody is on it — the fix is the
 * all-zero check in `components/DayNotify.tsx` that answers with a sentence
 * instead of the confirmation.
 *
 * Same jsdom + `createRoot` harness as `test/helper-chat.test.tsx`, rather
 * than adding `@testing-library/react` for one component.
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

function statusWith(pending: { channel: "mail" | "whatsapp"; count: number; cost: number }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        reachable: true,
        alreadySent: false,
        pending,
        needed: 0,
        balance: null,
        short: false,
      }),
    })),
  );
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <DayNotify username="alex" tripId="ridge-2025" slug="2025-05-01-arrival" />
      </LocaleProvider>,
    );
  });
  // Let the status fetch's promise chain resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DayNotify — nobody subscribed", () => {
  test("says nobody is signed up rather than offering a send", async () => {
    statusWith([
      { channel: "mail", count: 0, cost: 0 },
      { channel: "whatsapp", count: 0, cost: 1 },
    ]);
    await render();

    expect(container!.textContent).toContain(
      "Nobody is signed up to hear about this journal yet",
    );
    expect(container!.querySelector("button")).toBeNull();
  });

  test("still offers the button when somebody is subscribed", async () => {
    statusWith([{ channel: "mail", count: 3, cost: 0 }]);
    await render();

    expect(container!.querySelector("button")).not.toBeNull();
    expect(container!.textContent).not.toContain("Nobody is signed up");
  });
});

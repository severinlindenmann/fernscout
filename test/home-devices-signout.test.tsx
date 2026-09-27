// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { YourDevices, type HomeDevice } from "@/components/HomeJournals";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2451 — signing out THIS device from the home page's device list used to
 * call only `DELETE /api/v2/me/devices/{id}`, which deliberately revokes the
 * instance-wide identity session but leaves cookies (and any journal session
 * behind `GUEST_COOKIE`) in place — a sign-out button that visibly did
 * nothing when a browser also held a journal session. The fix makes the
 * current-device row call `POST /api/auth/logout`, the same call the
 * journal's own sign-out button makes, which revokes and clears both.
 *
 * Same jsdom + createRoot harness as test/day-notify-nobody.test.tsx.
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

const devices: HomeDevice[] = [
  { id: "this-one", createdAt: "2026-01-01", lastSeenAt: null, userAgent: "iPhone Safari", current: true },
  { id: "other-one", createdAt: "2026-01-01", lastSeenAt: null, userAgent: "Macintosh Chrome", current: false },
];

async function render(onRevoke: (id: string) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <YourDevices devices={devices} onRevoke={onRevoke} />
      </LocaleProvider>,
    );
  });
}

describe("YourDevices sign-out (B2451)", () => {
  test("signing out THIS device calls the full logout, not the device DELETE", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method });
        return { ok: true, json: async () => ({ ok: true }) };
      }),
    );
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    const onRevoke = vi.fn();
    await render(onRevoke);

    const buttons = container!.querySelectorAll("button");
    // First row is the current device (order matches the `devices` array).
    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(calls).toEqual([{ url: "/api/auth/logout", method: "POST" }]);
    expect(onRevoke).not.toHaveBeenCalled();
  });

  test("signing out another device still uses the device DELETE", async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method });
        return { ok: true, json: async () => ({ ok: true, current: false }) };
      }),
    );

    const onRevoke = vi.fn();
    await render(onRevoke);

    const buttons = container!.querySelectorAll("button");
    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(calls).toEqual([{ url: "/api/v2/me/devices/other-one", method: "DELETE" }]);
    expect(onRevoke).toHaveBeenCalledWith("other-one");
  });
});

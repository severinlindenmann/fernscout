// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * Bring your own server, at the foot of the landing page. Inside the iPhone
 * app only; signed out it is a form, signed in one line naming the server;
 * an app without the native plugin, or a browser, gets nothing at all.
 */

const bridge = vi.hoisted(() => ({
  native: true,
  status: vi.fn(),
  choose: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/components/nativeShell", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/nativeShell")>();
  return {
    ...real,
    useNativeShell: () => bridge.native,
    serverChoiceStatus: bridge.status,
    chooseServer: bridge.choose,
    resetServer: bridge.reset,
  };
});

import ServerChoice from "@/components/ServerChoice";
import { serverChoiceError } from "@/components/nativeShell";

let host: HTMLDivElement;
let root: Root;

async function mount(signedIn: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <ServerChoice signedIn={signedIn} />
      </LocaleProvider>,
    );
  });
  return host;
}

beforeEach(() => {
  bridge.native = true;
  bridge.status.mockReset().mockResolvedValue({
    custom: false,
    host: "journal.test",
    server: "https://journal.test",
    defaultServer: "https://journal.test",
  });
  bridge.choose.mockReset().mockResolvedValue({ changed: false });
  bridge.reset.mockReset().mockResolvedValue({ changed: false });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ServerChoice", () => {
  test("a browser gets nothing, and never asks the bridge", async () => {
    bridge.native = false;
    const el = await mount(false);
    expect(el.innerHTML).toBe("");
    expect(bridge.status).not.toHaveBeenCalled();
  });

  test("an app built before the plugin existed gets nothing", async () => {
    bridge.status.mockRejectedValue(new Error("not implemented"));
    const el = await mount(false);
    expect(el.innerHTML).toBe("");
  });

  test("signed in: one line naming the server, no form", async () => {
    const el = await mount(true);
    expect(el.textContent).toBe("Connected to journal.test");
    expect(el.querySelector("form")).toBeNull();
  });

  test("signed out: the form, and the address goes to the plugin with placeholders for native to fill", async () => {
    const el = await mount(false);
    expect(el.textContent).toContain("Bring your own server");
    const input = el.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, " travel.example.org ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(bridge.choose).toHaveBeenCalledTimes(1);
    const [url, copy] = bridge.choose.mock.calls[0];
    expect(url).toBe("travel.example.org");
    // The host on the dialog is native's to fill in, never the page's.
    expect(copy.confirmBody).toContain("{host}");
    expect(copy.confirmLabel).toContain("{host}");
    expect(copy.unreachableBody).toContain("{host}");
  });

  test("a refusal is reported, not treated as a switch", async () => {
    bridge.choose.mockRejectedValue(Object.assign(new Error("x"), { code: "notFernscout" }));
    const el = await mount(false);
    const input = el.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "example.org");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toBe("No Fernscout answered at that address.");
  });

  test("on a chosen server, signed out, the way back to the default is offered", async () => {
    bridge.status.mockResolvedValue({
      custom: true,
      host: "travel.example.org",
      server: "https://travel.example.org",
      defaultServer: "https://journal.test",
    });
    const el = await mount(false);
    expect(el.textContent).toContain("Connected to travel.example.org");
    expect(el.textContent).toContain("Use journal.test again");
  });
});

describe("serverChoiceError", () => {
  test("names the plugin's own codes and nothing else", () => {
    expect(serverChoiceError({ code: "invalid" })).toBe("invalid");
    expect(serverChoiceError({ code: "notFernscout" })).toBe("notFernscout");
    expect(serverChoiceError({ code: "recording" })).toBe("recording");
    expect(serverChoiceError({ code: "something" })).toBe("unreachable");
    expect(serverChoiceError(null)).toBe("unreachable");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ShareLink from "@/components/studio/readers/ShareLink";
import { translate } from "@/lib/i18n";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2444 (W44 D4) — the owner's own invite: a ready-made, editable text in
 * their own language, Copy puts the message and the link together on the
 * clipboard, Share hands the edited message to the system share sheet, and
 * either one tells `readers/shared` a share happened (best-effort, never
 * blocking).
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dict = dictionaryFor("en");
const t = (key: string, vars?: Record<string, string>) => translate(dict, key, vars);

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

function render(overrides: Partial<React.ComponentProps<typeof ShareLink>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ShareLink
        username="alex"
        url="https://fernscout.test/j/abc123"
        title="Two Backpacks"
        text="Hi! I'm writing about Two Backpacks on Fernscout. Read along here:"
        t={t}
        {...overrides}
      />,
    );
  });
}

test("the textarea starts prefilled with the ready-made text, and is editable", () => {
  render();
  const textarea = container!.querySelector("textarea")!;
  expect(textarea.value).toBe("Hi! I'm writing about Two Backpacks on Fernscout. Read along here:");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(textarea, "My own words instead");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(textarea.value).toBe("My own words instead");
});

test("Copy puts the message and the URL on the clipboard together, and logs the share", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  render();

  const copyButton = Array.from(container!.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(dict["readers.link.copy"]),
  )!;
  await act(async () => {
    copyButton.click();
    await Promise.resolve();
  });

  expect(writeText).toHaveBeenCalledWith(
    "Hi! I'm writing about Two Backpacks on Fernscout. Read along here:\n\nhttps://fernscout.test/j/abc123",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/web/alex/readers/shared",
    expect.objectContaining({ method: "POST" }),
  );
});

test("a contactId, when given, rides along in the log call", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  render({ contactId: "c-1" });

  const copyButton = Array.from(container!.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(dict["readers.link.copy"]),
  )!;
  await act(async () => {
    copyButton.click();
    await Promise.resolve();
  });

  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(String(init.body))).toEqual({ contactId: "c-1" });
});

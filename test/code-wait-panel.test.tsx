// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CodeWaitPanel, { MailSenderProvider } from "@/components/CodeWaitPanel";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/** B2844 — the shared "check your email" panel. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CodeWaitPanel", () => {
  let root: Root;
  let container: HTMLDivElement;
  const submitted: string[] = [];
  const asked: number[] = [];

  function Harness() {
    const [code, setCode] = useState("");
    return (
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <MailSenderProvider address="agent@example.test">
          <CodeWaitPanel
            id="c"
            email="reader@example.test"
            minutes="20"
            code={code}
            onCodeChange={setCode}
            onSubmit={(d) => submitted.push(d)}
            onResend={() => {
              asked.push(1);
            }}
            onWrongAddress={() => {}}
            busy={false}
            buttonClassName=""
          />
        </MailSenderProvider>
      </LocaleProvider>
    );
  }
  const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[name="code"]')];
  const again = () =>
    [...container.querySelectorAll("button")].find((b) => /Send a new code/.test(b.textContent ?? ""))!;

  beforeEach(() => {
    vi.useFakeTimers();
    submitted.length = 0;
    asked.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  test("names the address, the sender, and where the mail hides", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("reader@example.test");
    expect(text).toContain("agent@example.test");
    expect(text).toMatch(/Spam or Junk.*Promotions/);
    expect(text).toContain("Not spam");
  });

  test("one field: a pasted or autofilled code fills it and submits once; autofill attribute stays", () => {
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].autocomplete).toBe("one-time-code");
    expect(boxes()[0].inputMode).toBe("numeric");
    act(() => setValue(boxes()[0], "123456"));
    expect(boxes()[0].value).toBe("123456");
    expect(submitted).toEqual(["123456"]);
  });

  test("only the digits count: a spaced or sentence paste reads as the code", () => {
    act(() => setValue(boxes()[0], "Your code is 482 915"));
    expect(boxes()[0].value).toBe("482915");
    expect(submitted).toEqual(["482915"]);
  });

  test("typing digit by digit submits on the sixth, not before", () => {
    "12345".split("").forEach((_, i) => act(() => setValue(boxes()[0], "12345".slice(0, i + 1))));
    expect(submitted).toEqual([]);
    act(() => setValue(boxes()[0], "123456"));
    expect(submitted).toEqual(["123456"]);
  });

  test("Send a new code is locked with a countdown for 60 s, then asks again", async () => {
    expect(again().disabled).toBe(true);
    expect(again().textContent).toContain("1:00");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(again().textContent).toContain("0:30");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(again().disabled).toBe(false);
    await act(async () => again().click());
    expect(asked).toHaveLength(1);
    expect(again().disabled).toBe(true);
  });
});

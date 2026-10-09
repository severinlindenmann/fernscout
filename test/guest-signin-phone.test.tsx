// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import GuestSignIn from "@/components/GuestSignIn";
import { SmsSignInProvider } from "@/components/CodeWaitPanel";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/** B-2948 — a guest who joined by mobile number signs back in with the number. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const dict = dictionaryFor("en");
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

describe("GuestSignIn by mobile number", () => {
  let root: Root;
  let container: HTMLDivElement;
  const bodies: Record<string, unknown>[] = [];

  function mount(smsOn: boolean) {
    act(() =>
      root.render(
        <LocaleProvider locale="en" dictionary={dict}>
          <SmsSignInProvider enabled={smsOn}>
            <GuestSignIn username="ana" codeMinutes="20" />
          </SmsSignInProvider>
        </LocaleProvider>,
      ),
    );
  }
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const link = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

  beforeEach(() => {
    bodies.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      bodies.push({ url: String(url), ...JSON.parse(String(init?.body ?? "{}")) });
      return { ok: true, status: 202, json: async () => ({}) } as Response;
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  test("with SMS off there is no mobile option at all", () => {
    mount(false);
    expect(link(dict["me.signInUsePhone"])).toBeUndefined();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  test("with SMS on the number can be chosen, is checked, and asks for a text, not a mail", async () => {
    mount(true);
    act(() => link(dict["me.signInUsePhone"])!.click());
    expect(container.querySelector('input[type="email"]')).toBeNull();
    const tel = container.querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(tel).not.toBeNull();

    // An unreadable number is said and nothing is sent.
    type(tel, "12");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(container.textContent).toContain(dict["me.signInPhoneBad"]);
    expect(bodies).toHaveLength(0);

    type(tel, "+41 79 555 88 11");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ url: "/api/auth/codes", for: "read", user: "ana", phone: "+41 79 555 88 11" });
    expect(bodies[0]).not.toHaveProperty("email");

    // The code step speaks of a text and a number: no spam advice about mail.
    expect(container.textContent).toContain("by text");
    expect(container.textContent).toContain(dict["codeWait.wrongNumber"]);
    expect(container.textContent).not.toContain("Spam");
    const code = container.querySelector<HTMLInputElement>("#signin-code")!;
    expect(code.autocomplete).toBe("one-time-code");
  });

  test("the six digits redeem with the number, never with an email", async () => {
    mount(true);
    act(() => link(dict["me.signInUsePhone"])!.click());
    type(container.querySelector<HTMLInputElement>('input[type="tel"]')!, "+41 79 555 88 11");
    await act(async () => container.querySelector("form")!.requestSubmit());
    bodies.length = 0;
    // reload() is not implemented in jsdom; a wrong code is enough to see the body.
    vi.mocked(global.fetch).mockImplementation(async (url, init) => {
      bodies.push({ url: String(url), ...JSON.parse(String(init?.body ?? "{}")) });
      return { ok: false, status: 401, json: async () => ({}) } as Response;
    });
    type(container.querySelector<HTMLInputElement>("#signin-code")!, "123456");
    await act(async () => {});
    expect(bodies.at(-1)).toMatchObject({ url: "/api/auth/codes/redeem", for: "read", user: "ana", phone: "+41 79 555 88 11", code: "123456" });
    expect(bodies.at(-1)).not.toHaveProperty("email");
    expect(container.textContent).toContain(dict["me.signInWrong"]);
  });

  test("a server that cannot text the number says so in words", async () => {
    mount(true);
    act(() => link(dict["me.signInUsePhone"])!.click());
    vi.mocked(global.fetch).mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    type(container.querySelector<HTMLInputElement>('input[type="tel"]')!, "+41 79 555 88 11");
    await act(async () => container.querySelector("form")!.requestSubmit());
    expect(container.textContent).toContain(dict["me.signInPhoneUnavailable"]);
    expect(container.querySelector("#signin-code")).toBeNull();
  });
});

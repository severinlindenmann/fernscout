// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WelcomeGuide, { type GuideProps } from "@/app/w/[code]/WelcomeGuide";
import JoinFlow from "@/app/j/[code]/JoinFlow";
import { guideWords } from "@/lib/locales";

/**
 * B2293 — the guide's screens as a person steps through them: which screens
 * a reader, a buddy and a person who joined by link get, and that a channel
 * this server cannot use is absent while one whose address is missing is
 * disabled with its reason.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const dict = guideWords("en");
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
const press = (text: string) => {
  const button = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`no button "${text}" in: ${container!.textContent}`);
  act(() => button.click());
};
const heading = () => container!.querySelector("h1")?.textContent ?? "";
const fill = (key: string, vars: Record<string, string> = {}) =>
  Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), dict[key]);

const base: GuideProps = {
  code: "2345678923",
  owner: "ana",
  title: "Two Backpacks",
  ownerName: "Ana",
  firstName: "Lena",
  kind: "reader",
  trip: null,
  signedIn: true,
  onboarded: false,
  joined: false,
  prove: { email: "le•••@example.test", mobile: null, preferred: "email" },
  details: {
    name: "Lena Brunner",
    email: "lena@example.test",
    phone: null,
    emailProven: true,
    phoneProven: false,
    address: { line1: "", postcode: "", city: "", country: "" },
    wantsEmailDigest: false,
    wantsWhatsapp: false,
    wantsSms: false,
    wantsPostcard: false,
  },
  caps: { mail: true, sms: true, whatsapp: false, postcards: true },
  dictionary: dict,
};

describe("the reader's guide", () => {
  test("signed in already: welcome, what you can do, is this right, address, then the ticks — no code screen", () => {
    mount(<WelcomeGuide {...base} />);
    expect(heading()).toBe(fill("guide.welcome.readerTitle", { name: "Lena", owner: "Ana" }));
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.what.readerTitle"]);
    press(dict["guide.what.go"]);
    expect(heading()).toBe(fill("guide.check.title", { owner: "Ana" }));
    // The owner-typed name, with That's right / Change; the missing mobile asked for.
    expect(container!.textContent).toContain("Lena Brunner");
    expect(container!.textContent).toContain(dict["guide.check.mobileMissing"]);
    press(dict["guide.check.next"]);
    expect(heading()).toBe(dict["guide.address.title"]);
    press(dict["guide.address.skip"]);
    expect(heading()).toBe(dict["guide.notify.title"]);
    const labels = Array.from(container!.querySelectorAll("label")).map((l) => l.textContent ?? "");
    // WhatsApp is off on this server: absent, not greyed out.
    expect(labels.some((l) => l.startsWith(dict["guide.notify.whatsapp"]))).toBe(false);
    // SMS is on, but there is no number: shown disabled with its reason.
    const sms = Array.from(container!.querySelectorAll("label")).find((l) => l.textContent?.startsWith(dict["guide.notify.sms"]))!;
    expect(sms.textContent).toContain(dict["guide.notify.needsMobile"]);
    expect(sms.querySelector("input")!.disabled).toBe(true);
    press(dict["guide.notify.open"]);
  });

  test("not signed in: the code screen is second, and asks before it sends anything", () => {
    mount(<WelcomeGuide {...base} signedIn={false} details={null} />);
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.code.title"]);
    expect(container!.textContent).toContain("le•••@example.test");
    expect(container!.querySelector("#guide-code-input")).toBeNull();
    press(dict["guide.code.send"]);
  });

  test("a buddy is welcomed aboard and ends on their trip", () => {
    mount(<WelcomeGuide {...base} kind="buddy" trip={{ id: "iceland", title: "Iceland 2026" }} caps={{ ...base.caps, postcards: false }} />);
    expect(heading()).toBe(fill("guide.welcome.buddyTitle", { name: "Lena" }));
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.what.buddyTitle"]);
    press(dict["guide.what.go"]);
    press(dict["guide.check.next"]);
    // Postcards off: no address screen at all.
    expect(heading()).toBe(dict["guide.notify.buddyTitle"]);
    expect(container!.textContent).toContain(fill("guide.notify.openTrip", { trip: "Iceland 2026" }));
    expect(container!.textContent).toContain(dict["guide.notify.justRead"]);
  });

  test("somebody who joined by a link lands on what you can do, then in", () => {
    mount(<WelcomeGuide {...base} joined />);
    expect(heading()).toBe(dict["guide.what.readerTitle"]);
    expect(container!.textContent).toContain(dict["guide.notify.open"]);
  });
});

describe("the join flow", () => {
  test("whose journal, then email or mobile as tabs", () => {
    mount(
      <JoinFlow
        code="2345678923"
        owner="ana"
        title="Two Backpacks"
        ownerName="Ana"
        kind="guest"
        tripTitle={null}
        knownEmail={null}
        caps={{ mail: true, sms: true, whatsapp: false, postcards: true }}
        dictionary={dict}
        locale="en"
      />,
    );
    expect(heading()).toBe(dict["join.who.title"]);
    press(dict["join.who.go"]);
    // No name: said, and not moved on.
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(dict["join.error.name"]);
    const input = container!.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Anna");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    press(dict["join.who.go"]);
    expect(heading()).toBe(fill("join.reach.title", { owner: "Ana" }));
    const tabs = Array.from(container!.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).toEqual([dict["join.reach.email"], dict["join.reach.mobile"]]);
  });

  test("with SMS off there is no mobile tab", () => {
    mount(
      <JoinFlow
        code="2345678923"
        owner="ana"
        title="T"
        ownerName="Ana"
        kind="guest"
        tripTitle={null}
        knownEmail="an•••@example.test"
        caps={{ mail: true, sms: false, whatsapp: false, postcards: false }}
        dictionary={dict}
        locale="en"
      />,
    );
    // Signed in already: no email or code screen to reach at all.
    expect(container!.textContent).toContain(fill("join.who.signedIn", { email: "an•••@example.test" }));
    expect(container!.querySelector('[role="tab"]')).toBeNull();
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import WelcomeGuide, { type GuideProps } from "@/app/w/[code]/WelcomeGuide";
import JoinFlow from "@/app/j/[code]/JoinFlow";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2293 — the guide's screens as a person steps through them: which screens
 * a reader, a buddy and a person who joined by link get, and that a channel
 * this server cannot use is absent while one whose address is missing is
 * disabled with its reason.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const dict = dictionaryFor("en", "guide");
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
  hasGuestTrip: true,
  landing: "/ana/trips/iceland",
  figures: [],
  recent: [],
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
  // B2597: readers sign in by email only — `sms` is always false in practice
  // (`app/w/[code]/page.tsx` forces it), kept here only as the prop shape.
  caps: { mail: true, sms: false, whatsapp: false, postcards: true },
  dictionary: dict,
  locale: "en",
  locales: ["en"],
  addressLookupEnabled: false,
};

describe("the reader's guide", () => {
  test("signed in already: welcome, what you can do, is this right, address, then the ticks — no code screen", () => {
    mount(<WelcomeGuide {...base} />);
    expect(heading()).toBe(fill("guide.welcome.readerTitle", { name: "Lena", owner: "Ana" }));
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.what.readerTitle"]);
    press(dict["guide.what.go"]);
    expect(heading()).toBe(fill("guide.check.title", { owner: "Ana" }));
    // The owner-typed name, with That's right / Change. B2597: no mobile is
    // ever asked for here any more — email is the only sign-in channel.
    expect(container!.textContent).toContain("Lena Brunner");
    expect(container!.textContent).not.toContain(dict["guide.check.mobileMissing"]);
    press(dict["guide.check.next"]);
    expect(heading()).toBe(dict["guide.address.title"]);
    press(dict["guide.address.skip"]);
    expect(heading()).toBe(dict["guide.notify.title"]);
    const labels = Array.from(container!.querySelectorAll("label")).map((l) => l.textContent ?? "");
    // WhatsApp is off on this server: absent, not greyed out.
    expect(labels.some((l) => l.startsWith(dict["guide.notify.whatsapp"]))).toBe(false);
    // SMS is retired entirely (B2597): no such option, on or off.
    expect(labels.some((l) => l.startsWith(dict["guide.notify.sms"]))).toBe(false);
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

  test("B2365 — on a journal with a guest trip, the promise does not claim costs are hidden", () => {
    // A guest trip's costs are shown to every approved guest who can read it
    // (lib/access.ts maySeeCosts), so the blanket "you won't see costs" is
    // false here; the sentence must say it depends on what the owner shares.
    mount(<WelcomeGuide {...base} hasGuestTrip />);
    press(dict["guide.welcome.go"]);
    expect(container!.textContent).toContain(fill("guide.what.readerLimitsCostsVary", { owner: "Ana" }));
    expect(container!.textContent).not.toContain(dict["guide.what.readerLimits"]);
  });

  test("B2365 — on a journal with no guest trip at all, costs really are unseen", () => {
    mount(<WelcomeGuide {...base} hasGuestTrip={false} />);
    press(dict["guide.welcome.go"]);
    expect(container!.textContent).toContain(dict["guide.what.readerLimits"]);
  });

  test("B2452 — the address step offers a country combobox, and the street field only suggests with addressLookup on", () => {
    mount(<WelcomeGuide {...base} addressLookupEnabled />);
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.what.readerTitle"]);
    press(dict["guide.what.go"]);
    press(dict["guide.check.next"]);
    expect(heading()).toBe(dict["guide.address.title"]);
    const country = container!.querySelector('[aria-label="Country"]');
    expect(country?.getAttribute("role")).toBe("combobox");
    const street = container!.querySelector("#guide-address-line1");
    expect(street?.getAttribute("role")).toBe("combobox");
  });

  test("B2452 — with addressLookup off, the street field is a plain input, not broken", () => {
    mount(<WelcomeGuide {...base} addressLookupEnabled={false} />);
    press(dict["guide.welcome.go"]);
    press(dict["guide.what.go"]);
    press(dict["guide.check.next"]);
    const street = container!.querySelector("#guide-address-line1");
    expect(street?.getAttribute("role")).toBeNull();
    // The country picker still runs unconditionally, same as on /me.
    expect(container!.querySelector('[aria-label="Country"]')?.getAttribute("role")).toBe("combobox");
  });
});

describe("the join flow", () => {
  // B2597: readers sign in by email only — the join link's mobile tab and its
  // "code screen draws a phone for SMS" test are gone with it.
  test("whose journal, then straight to an email field — no tabs any more", () => {
    mount(
      <JoinFlow
        code="2345678923"
        owner="ana"
        title="Two Backpacks"
        ownerName="Ana"
        kind="guest"
        tripTitle={null}
        knownEmail={null}
        caps={{ mail: true, sms: false, whatsapp: false, postcards: true }}
        dictionary={dict}
        locale="en"
        locales={["en"]}
        addressLookupEnabled={false}
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
    expect(container!.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container!.querySelector('input[type="email"]')).not.toBeNull();
  });

  test("B2504 — News from Fernscout starts ticked, and is sent as consent unless unticked", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ ok: true, status: "waiting" }) } as Response;
    });
    mount(
      <JoinFlow
        code="2345678923"
        owner="ana"
        title="Two Backpacks"
        ownerName="Ana"
        kind="guest"
        tripTitle={null}
        knownEmail="an•••@example.test"
        caps={{ mail: true, sms: false, whatsapp: false, postcards: false }}
        dictionary={dict}
        locale="en"
        locales={["en"]}
        addressLookupEnabled={false}
      />,
    );
    const input = container!.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Anna");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      press(dict["join.who.go"]);
      await Promise.resolve();
    });
    const news = Array.from(container!.querySelectorAll("label")).find((l) => l.textContent?.includes(dict["join.notify.news"]));
    expect(news?.querySelector("input")?.checked).toBe(true);
    const save = Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.trim() === dict["join.notify.send"]);
    await act(async () => {
      save!.click();
      await Promise.resolve();
    });
    expect(bodies.at(-1)).toMatchObject({ action: "save", wantsNews: true });
    fetchMock.mockRestore();
  });

  test("B2505 — a waiting reader ticks WhatsApp postcards, types a mobile, and it is saved with the request", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ ok: true, status: "waiting" }) } as Response;
    });
    mount(
      <JoinFlow
        code="2345678923"
        owner="ana"
        title="Two Backpacks"
        ownerName="Ana"
        kind="guest"
        tripTitle={null}
        knownEmail="an•••@example.test"
        caps={{ mail: true, sms: false, whatsapp: true, postcards: false }}
        dictionary={dict}
        locale="en"
        locales={["en"]}
        addressLookupEnabled={false}
      />,
    );
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const type = (input: HTMLInputElement, value: string) =>
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type(container!.querySelector("input")!, "Anna");
    await act(async () => {
      press(dict["join.who.go"]);
      await Promise.resolve();
    });
    const row = Array.from(container!.querySelectorAll("label")).find((l) => l.textContent?.includes(dict["guide.notify.whatsapp"]))!;
    expect(row.querySelector('[data-testid="postcard-icon"]')).not.toBeNull();
    const box = row.querySelector("input")!;
    expect(box.disabled).toBe(false);
    expect(container!.querySelector('input[type="tel"]')).toBeNull();
    act(() => box.click());
    const tel = container!.querySelector<HTMLInputElement>('input[type="tel"]')!;
    expect(tel).not.toBeNull();
    // Ticked with no number: said, and nothing posted.
    const sent = bodies.length;
    await act(async () => {
      press(dict["join.notify.send"]);
      await Promise.resolve();
    });
    expect(bodies.length).toBe(sent);
    type(tel, "+41 79 555 88 11");
    await act(async () => {
      press(dict["join.notify.send"]);
      await Promise.resolve();
    });
    expect(bodies.at(-1)).toMatchObject({ action: "save", wantsWhatsapp: true, tel: "+41 79 555 88 11" });
    fetchMock.mockRestore();
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
        locales={["en"]}
        addressLookupEnabled={false}
      />,
    );
    // Signed in already: no email or code screen to reach at all.
    expect(container!.textContent).toContain(fill("join.who.signedIn", { email: "an•••@example.test" }));
    expect(container!.querySelector('[role="tab"]')).toBeNull();
  });
});

describe("the guide never sends a guest to the bare journal address (B2458)", () => {
  test("every exit goes to the page's landing, not /<owner>", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("app/w/[code]/WelcomeGuide.tsx", "utf8");
    expect(src).not.toMatch(/`\/\$\{owner\}`/);
    const page = fs.readFileSync("app/w/[code]/page.tsx", "utf8");
    expect(page).toMatch(/redirect\(landing\)/);
  });
});

describe("the welcome is personal (B2457)", () => {
  test("recent trips show as plain covers with a title, never as links", () => {
    mount(
      <WelcomeGuide
        {...base}
        recent={[
          { id: "algarve", title: "Algarve 2026", cover: null, year: "2026" },
          { id: "davos", title: "Davos 2026", cover: null, year: "2026" },
        ]}
      />,
    );
    press(dict["guide.welcome.go"]);
    expect(heading()).toBe(dict["guide.what.readerTitle"]);
    const strip = container!.querySelector('section[aria-labelledby="guide-recent"]')!;
    expect(strip.textContent).toContain("Algarve 2026");
    expect(strip.textContent).toContain("Davos 2026");
    expect(strip.querySelector("a")).toBeNull();
  });

  test("no recent trips, no strip", () => {
    mount(<WelcomeGuide {...base} />);
    press(dict["guide.welcome.go"]);
    expect(container!.querySelector('section[aria-labelledby="guide-recent"]')).toBeNull();
  });

  test("the journal's figures replace the stock drawing when there are any", () => {
    mount(<WelcomeGuide {...base} figures={[{}, {}]} />);
    expect(container!.querySelector('[role="group"][aria-label="2 illustrated travellers"]')).not.toBeNull();
  });

  test("every tile's icon is readable on its own tone in dark mode", () => {
    mount(<WelcomeGuide {...base} />);
    press(dict["guide.welcome.go"]);
    const tiles = Array.from(container!.querySelectorAll("ul li > span:first-child"));
    expect(tiles.length).toBeGreaterThan(2);
    for (const tile of tiles) {
      const icon = tile.querySelector("svg")!.getAttribute("class") ?? "";
      if (tile.className.includes("bg-cream-100")) expect(icon).toContain("text-navy-900");
      else expect(icon).toContain("text-ink-strong");
    }
  });
});

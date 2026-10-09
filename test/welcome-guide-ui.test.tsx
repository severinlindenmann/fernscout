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
  const joinProps = (caps: { mail: boolean; sms: boolean; whatsapp: boolean; postcards: boolean }) => ({
    code: "2345678923",
    owner: "ana",
    title: "Two Backpacks",
    ownerName: "Ana",
    kind: "guest" as const,
    tripTitle: null,
    knownEmail: null,
    caps,
    dictionary: dict,
    locale: "en",
    locales: ["en"],
    addressLookupEnabled: false,
  });
  const typeInto = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const leave = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  const goButton = () => Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.trim() === dict["join.who.go"])!;

  // B2941: name, email and mobile on one page; a bad value is said, and Continue
  // stays off until one contact is valid.
  test("B2941 — name, email and mobile on one page; a bad email is said and blocks Continue", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ ok: true, to: "anna@example.test" }) } as Response;
    });
    mount(<JoinFlow {...joinProps({ mail: true, sms: false, whatsapp: false, postcards: false })} />);
    expect(heading()).toBe(dict["join.who.title"]);
    expect(container!.querySelector('input[type="email"]')).not.toBeNull();
    expect(container!.querySelector('input[type="tel"]')).not.toBeNull();
    expect(goButton().disabled).toBe(true);
    const [name] = Array.from(container!.querySelectorAll<HTMLInputElement>("input"));
    typeInto(name, "Anna");
    const email = container!.querySelector<HTMLInputElement>('input[type="email"]')!;
    typeInto(email, "anna@");
    leave(email);
    expect(container!.textContent).toContain(dict["join.who.errEmail"]);
    expect(goButton().disabled).toBe(true);
    typeInto(email, "anna@example.test");
    expect(container!.textContent).not.toContain(dict["join.who.errEmail"]);
    expect(container!.textContent).toContain(dict["join.who.onlyEmail"]);
    expect(goButton().disabled).toBe(false);
    await act(async () => {
      goButton().click();
      await Promise.resolve();
    });
    // One way only: no pick screen, the mail goes out and the code page warns about Spam.
    expect(bodies.at(-1)).toMatchObject({ action: "send", channel: "email", value: "anna@example.test" });
    expect(heading()).toBe(dict["join.code.inbox"]);
    expect(container!.textContent).toContain(dict["join.code.spamTitle"]);
    expect(container!.querySelector<HTMLInputElement>("#join-code-input")?.autocomplete).toBe("one-time-code");
    fetchMock.mockRestore();
  });

  test("B2941 — with a mobile too, WhatsApp comes first and opens a message instead of asking for a code", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return { ok: true, json: async () => (body.action === "wa-start" ? { ok: true, id: "w1", link: "https://wa.me/41000?text=FS" } : { ok: true }) } as Response;
    });
    mount(<JoinFlow {...joinProps({ mail: true, sms: true, whatsapp: true, postcards: false })} />);
    const [name] = Array.from(container!.querySelectorAll<HTMLInputElement>("input"));
    typeInto(name, "Anna");
    typeInto(container!.querySelector<HTMLInputElement>('input[type="email"]')!, "anna@example.test");
    typeInto(container!.querySelector<HTMLInputElement>('input[type="tel"]')!, "+41 79 555 88 11");
    await act(async () => {
      goButton().click();
      await Promise.resolve();
    });
    expect(heading()).toBe(dict["join.pick.title"]);
    const options = Array.from(container!.querySelectorAll("button")).map((b) => b.textContent ?? "");
    const at = (label: string) => options.findIndex((o) => o.startsWith(label));
    expect(at(dict["join.pick.whatsapp"])).toBeGreaterThan(-1);
    expect(at(dict["join.pick.whatsapp"])).toBeLessThan(at(dict["join.pick.sms"]));
    expect(at(dict["join.pick.sms"])).toBeLessThan(at(dict["join.pick.email"]));
    expect(container!.textContent).toContain(dict["join.pick.emailWarn"]);
    await act(async () => {
      Array.from(container!.querySelectorAll("button")).find((b) => b.textContent?.startsWith(dict["join.pick.whatsapp"]))!.click();
      await Promise.resolve();
    });
    expect(bodies.at(-1)).toMatchObject({ action: "wa-start" });
    expect(heading()).toBe(dict["join.wa.title"]);
    expect(container!.querySelector<HTMLAnchorElement>("a[href^='https://wa.me/']")).not.toBeNull();
    expect(container!.querySelector("#join-code-input")).toBeNull();
    fetchMock.mockRestore();
  });

  // B2943: a person let in by the link sees what was confirmed and one button;
  // the day letter is a choice, never assumed, and nothing is promised on WhatsApp.
  test("B2943 — the ready page names the journal and owner, offers choices unticked, and saves them on Open", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ ok: true, status: "in", known: false }) } as Response;
    });
    mount(<JoinFlow {...joinProps({ mail: true, sms: false, whatsapp: true, postcards: false })} knownEmail="an•••@example.test" />);
    typeInto(container!.querySelector<HTMLInputElement>("input")!, "Anna");
    await act(async () => {
      goButton().click();
      await Promise.resolve();
    });
    expect(heading()).toBe(fill("join.ready.title", { title: "Two Backpacks" }));
    expect(container!.textContent).toContain(fill("join.ready.by", { owner: "Ana" }));
    expect(container!.textContent).toContain(fill("join.ready.bodyEmail", { name: "Anna" }));
    expect(container!.textContent).toContain(dict["join.ready.howTitle"]);
    // Nothing about WhatsApp is promised, and the owner is not named as approving.
    expect(container!.textContent).not.toMatch(/whatsapp/i);
    expect(container!.textContent).not.toContain("let you in");
    const box = (label: string) =>
      Array.from(container!.querySelectorAll("label")).find((l) => l.textContent?.includes(label))?.querySelector("input");
    expect(box(fill("join.ready.digest", { owner: "Ana" }))?.checked).toBe(false);
    expect(box(dict["join.notify.news"])?.checked).toBe(true);
    await act(async () => {
      press(dict["guide.notify.open"]);
      await Promise.resolve();
    });
    expect(bodies.at(-1)).toMatchObject({ action: "save", wantsEmailDigest: false, wantsNews: true });
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

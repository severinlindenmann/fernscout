// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import SignupWizard from "@/components/SignupWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { clearLocaleCache, dictionaryFor, localesFor } from "@/lib/locales";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { typeInto } from "./support/type-input";
import { calls, settle, stubWizardFetch } from "./support/wizard-fetch";

/**
 * B688 / B-2808 — a visitor with no journal, at `/welcome`: email, phone,
 * then one name. No network call anywhere: `fetch` is stubbed with the exact
 * shapes the signup routes answer, so what is under test is the component
 * reading those answers (the routes have their own tests).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

function withLocale(node: React.ReactNode) {
  return <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>{node}</LocaleProvider>;
}

const STATE_NO_PHONE = { emailProven: true, phoneProven: false, phoneRequired: false, mode: "code", smsFallback: false };
const CREATED = { ok: true, token: "agent-token", user: "robin", signIn: "https://example.test/@robin/s/link-token?lang=en" };
const free = (url: string) => ({ available: true, username: new URL(url, "http://t").searchParams.get("username") });

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

describe("the signup wizard", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    sessionStorage.clear();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-CH", "de"]);
    zone("UTC"); // B-2845: never the machine's own zone
  });
  function zone(timeZone: string) {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...realResolvedOptions.call(this), timeZone };
    });
  }

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const input = (id: string) => container!.querySelector(`#${id}`) as HTMLInputElement;
  const text = () => container!.textContent ?? "";
  const button = (label: RegExp) =>
    [...container!.querySelectorAll("button, a")].find((b) => label.test(b.textContent ?? "")) as HTMLElement;

  async function submit() {
    await act(async () => {
      container!.querySelector("form")!.requestSubmit();
    });
    await settle();
  }
  async function type(id: string, value: string, wait = 0) {
    await act(async () => typeInto(input(id), value));
    await settle(wait);
  }
  async function click(el: HTMLElement) {
    await act(async () => el.click());
    await settle();
  }
  function mount(props: Partial<React.ComponentProps<typeof SignupWizard>> = {}) {
    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(<SignupWizard locale="en" codeMinutes="20" onSignedIn={() => {}} onAlreadyOwns={() => {}} {...props} />),
      );
    });
  }
  /** Email and code, ending wherever the state route sends it. */
  async function toToken() {
    await type("signup-email", "new@example.test");
    await submit();
    await type("signup-code", "123456");
  }
  const baseRoutes = {
    "POST /api/auth/codes": { __status: 202, status: "accepted" },
    "POST /api/auth/codes/redeem": { ok: true, token: "signup-token" },
    "GET /api/auth/signup/state": STATE_NO_PHONE,
    "GET /api/v2/journals/available": free,
  };

  // ── step 1: email ───────────────────────────────────────────────────────
  test("the email step is one field, one notice line and no checkbox", () => {
    mount();
    expect(container!.querySelectorAll("input")).toHaveLength(1);
    expect(container!.querySelector('input[type="checkbox"]')).toBeNull();
    expect(text()).toContain("If you stop halfway, we'll mail you once with a link to continue.");
    expect(text()).toContain("1 Email");
    expect(text()).toContain("2 Phone");
    expect(text()).toContain("3 Your name");
  });

  test("an identity holder is told no code is needed and goes straight on", async () => {
    stubWizardFetch({ ...baseRoutes, "POST /api/auth/signup/identity": { token: "signup-token" } });
    mount({ email: "me@example.test" });
    expect(text()).toContain("You're signed in as me@example.test, so no code is needed");
    await submit();
    expect(calls.map((c) => c.url)).not.toContain("/api/auth/codes");
    expect(input("signup-name")).not.toBeNull();
  });

  // B2774 — a failed code request says why and stays on the email step.
  test.each([
    [429, { "retry-after": "3264" }, /Wait about 55 minutes/],
    [429, {}, /Wait a little/],
    [503, {}, /cannot send mail right now/],
    [404, {}, /Signing up is switched off/],
  ])("a %i from the code door is said on the email step", async (status, headers, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status, headers: new Headers(headers), json: async () => ({ error: "x" }) }),
      ),
    );
    mount();
    await type("signup-email", "new@example.test");
    await submit();
    expect(text()).toMatch(message);
    expect(text()).not.toMatch(/code is on its way/);
    expect(input("signup-email")).not.toBeNull();
    expect(input("signup-code")).toBeNull();
  });

  // ── step 1b: the code ───────────────────────────────────────────────────
  test("the code is one input that checks by itself after the sixth digit", async () => {
    stubWizardFetch(baseRoutes);
    mount();
    await type("signup-email", "new@example.test");
    await submit();
    const box = input("signup-code");
    expect(container!.querySelectorAll("input")).toHaveLength(1);
    expect(box.autocomplete).toBe("one-time-code");
    expect(box.inputMode).toBe("numeric");
    await type("signup-code", "12345");
    expect(calls.some((c) => c.url === "/api/auth/codes/redeem")).toBe(false);
    // A paste with a space still lands as six digits.
    await type("signup-code", "123 456");
    const redeem = calls.find((c) => c.url === "/api/auth/codes/redeem");
    expect(redeem?.body).toEqual({ for: "signup", email: "new@example.test", code: "123456" });
  });

  test("a wrong or expired code is said in words and the box is emptied", async () => {
    stubWizardFetch({ ...baseRoutes, "POST /api/auth/codes/redeem": { __status: 401, error: "invalid_code" } });
    mount();
    await toToken();
    expect(text()).toMatch(/isn't right, or it has expired/);
    expect(input("signup-code").value).toBe("");
  });

  test("resend counts down from 30 s, and Wrong address goes back to the email", async () => {
    stubWizardFetch(baseRoutes);
    mount();
    await type("signup-email", "new@example.test");
    await submit();
    expect(text()).toContain("Send again in 0:30");
    await click(button(/Wrong address\?/));
    expect(input("signup-email")).not.toBeNull();
    expect(input("signup-email").value).toBe("new@example.test");
  });

  // ── step 2: the phone ───────────────────────────────────────────────────
  const inbound = {
    ...baseRoutes,
    "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "whatsapp-inbound", smsFallback: true },
    "POST /api/auth/signup/phone": { __status: 202, id: "p1", link: "https://wa.me/41000?text=x", smsFallback: true, mode: "whatsapp-inbound" },
  };

  test("WhatsApp first: Open WhatsApp, nothing typed, then a waiting state that Check again polls", async () => {
    const pending = [{ status: "pending" }, { status: "pending" }, { ok: true, tel: "41760000001" }];
    stubWizardFetch({ ...inbound, "POST /api/auth/signup/phone/redeem": pending });
    mount();
    await toToken();
    expect(text()).toContain("Your phone number");
    expect(text()).toContain("Only you see it. It keeps one journal per number");
    expect(text()).toContain("Send the prepared message as it is, then come back here.");
    expect(container!.querySelector("#signup-tel")).toBeNull();
    const open = button(/Open WhatsApp/) as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe("https://wa.me/41000?text=x");
    expect(button(/No WhatsApp\? Use SMS instead/)).toBeTruthy();
    await click(open);
    expect(text()).toContain("Waiting for your message");
    expect(button(/Open WhatsApp again/)).toBeTruthy();
    expect(button(/Use SMS instead/)).toBeTruthy();
    const before = calls.filter((c) => c.url === "/api/auth/signup/phone/redeem").length;
    await click(button(/Check again/));
    expect(calls.filter((c) => c.url === "/api/auth/signup/phone/redeem").length).toBeGreaterThan(before);
  });

  test("coming back to the tab re-polls at once and moves on to the name", async () => {
    stubWizardFetch({ ...inbound, "POST /api/auth/signup/phone/redeem": { ok: true, tel: "41760000001" } });
    mount();
    await toToken();
    await click(button(/Open WhatsApp/));
    expect(input("signup-name")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(input("signup-name")).not.toBeNull();
  });

  test("SMS: the country defaults to the browser region, and its code checks by itself", async () => {
    stubWizardFetch({
      ...inbound,
      "POST /api/auth/signup/phone/redeem": [{ status: "pending" }, { ok: true, tel: "41760000001" }],
    });
    mount({ phoneCountryCode: "49" });
    await toToken();
    await click(button(/No WhatsApp\? Use SMS instead/));
    // de-CH: +41, not the operator's +49.
    expect(input("signup-tel-cc").value).toContain("+41");
    await type("signup-tel", "76 000 00 01");
    expect(button(/Text me a code/)).toBeTruthy();
    await submit();
    const request = calls.filter((c) => c.url === "/api/auth/signup/phone").pop()!;
    expect(request.body).toEqual({ tel: "+41 76 000 00 01", channel: "sms" });
    expect(text()).toContain("Code sent to +41 76 000 00 01");
    await type("signup-phone-code", "654321");
    const redeem = calls.filter((c) => c.url === "/api/auth/signup/phone/redeem").pop()!;
    expect(redeem.body).toEqual({ id: "p1", code: "654321" });
    expect(input("signup-name")).not.toBeNull();
  });

  test("with no browser region the operator's country stands", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    stubWizardFetch({ ...baseRoutes, "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" } });
    mount({ phoneCountryCode: "49" });
    await toToken();
    expect(input("signup-tel-cc").value).toContain("+49");
  });

  test("B-2825: an en-GB browser preselects the United Kingdom, not Guernsey", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB", "en"]);
    stubWizardFetch({ ...baseRoutes, "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" } });
    mount();
    await toToken();
    expect(input("signup-tel-cc").value).toContain("🇬🇧");
  });

  test("B-2824: a pasted +CC number in the national box is split before it is sent", async () => {
    stubWizardFetch({
      ...baseRoutes,
      "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" },
      "POST /api/auth/signup/phone": { __status: 202, id: "p1" },
    });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    mount();
    await toToken();
    await type("signup-tel", "+41 76 000 00 00");
    expect(input("signup-tel").value).toBe("76 000 00 00");
    expect(input("signup-tel-cc").value).toContain("+41");
    await submit();
    expect(calls.filter((c) => c.url === "/api/auth/signup/phone").pop()!.body.tel).toBe("+41 76 000 00 00");
  });

  test.each([
    ["invalid_request", 400, /doesn't look like a phone number/],
    ["sms_unreachable", 400, /text message can't reach that country/],
    ["verification_failed", 503, /code could not be sent/],
    ["too_many_requests", 429, /Too many codes have been asked for this number/],
  ])("B-2824: the phone request's %s gets its own sentence", async (error, status, message) => {
    stubWizardFetch({
      ...baseRoutes,
      "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" },
      "POST /api/auth/signup/phone": { __status: status, error },
    });
    mount();
    await toToken();
    await type("signup-tel", "76 000 00 00");
    await submit();
    expect(text()).toMatch(message);
    expect(text()).not.toContain("did not create your journal");
  });

  test("B-2827: a signup token from a first press does not say Welcome back", async () => {
    stubWizardFetch(baseRoutes);
    mount({ initialSignupToken: "signup-token", initialResumed: false });
    await settle();
    expect(input("signup-name")).not.toBeNull();
    expect(text()).not.toContain("Welcome back");
  });

  test("a number that already keeps a journal, found after proof, offers sign-in", async () => {
    stubWizardFetch({
      ...baseRoutes,
      "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" },
      "POST /api/auth/signup/phone": { __status: 202, id: "p1" },
      "POST /api/auth/signup/phone/redeem": { __status: 409, error: "tel_taken" },
    });
    mount();
    await toToken();
    await type("signup-tel", "76 000 00 01");
    await submit();
    await type("signup-phone-code", "123456");
    expect(text()).toContain("That number already keeps a journal — sign in to it instead");
    expect(container!.querySelector('a[href="/?start=1"]')).not.toBeNull();
  });

  test("an instance that asks for no phone skips the step", async () => {
    stubWizardFetch(baseRoutes);
    mount();
    await toToken();
    expect(input("signup-name")).not.toBeNull();
    expect(calls.some((c) => c.url.startsWith("/api/auth/signup/phone"))).toBe(false);
  });

  // ── step 3: the name ────────────────────────────────────────────────────
  test("one name field suggests an address, checks it live and says it is permanent", async () => {
    stubWizardFetch(baseRoutes);
    mount();
    await toToken();
    expect(container!.querySelectorAll("#signup-name")).toHaveLength(1);
    await type("signup-name", "Robin Traveller", 450);
    expect(text()).toContain("/@robin-traveller");
    expect(text()).toContain("Available");
    expect(text()).toContain("The address can't be changed later.");
    expect(text()).toContain("Choose a different address");
    expect(text()).toContain("Your journal starts like this");
    expect(text()).toContain("Asked not to list it");
    expect(text()).toContain("Who can read each trip is set on the trip itself.");
    expect(calls.some((c) => c.url.includes("available?username=robin-traveller"))).toBe(true);
  });

  test("a taken name keeps the name, asks for an address and offers only free ideas", async () => {
    stubWizardFetch({
      ...baseRoutes,
      "GET /api/v2/journals/available": (url: string) => {
        const u = new URL(url, "http://t").searchParams.get("username");
        return { available: u !== "example" && u !== "example-2", reason: "username_taken" };
      },
    });
    mount();
    await toToken();
    await type("signup-name", "Example", 450);
    await settle(50);
    expect(text()).toMatch(/\/@example is taken\. You stay “Example” — only your address needs to be different\./);
    expect(input("signup-username")).not.toBeNull();
    expect(input("signup-name").value).toBe("Example");
    const chips = [...container!.querySelectorAll("button")].map((b) => b.textContent);
    expect(chips).toContain(`example-${new Date().getFullYear()}`);
    expect(chips).toContain("example-3");
    expect(chips).not.toContain("example-2");
    await click(button(/^example-3$/));
    await settle(450);
    expect(input("signup-username").value).toBe("example-3");
    expect(text()).toContain("Free");
  });

  test("a name that makes no address (李) shows the address field at once", async () => {
    stubWizardFetch(baseRoutes);
    mount();
    await toToken();
    await type("signup-name", "李", 450);
    expect(input("signup-username")).not.toBeNull();
    expect(input("signup-username").value).toBe("");
    expect(button(/Create my journal/).hasAttribute("disabled")).toBe(true);
  });

  test("Create sends the one name three ways and every default explicitly", async () => {
    stubWizardFetch({ ...baseRoutes, "POST /api/v2/journals": CREATED, "POST /api/auth/links/redeem": { ok: true } });
    const onSignedIn = vi.fn();
    mount({ onSignedIn });
    await toToken();
    await type("signup-name", "Robin Traveller", 450);
    await submit();
    const body = calls.find((c) => c.url === "/api/v2/journals")!.body;
    expect(body).toEqual({
      title: "Robin Traveller",
      username: "robin-traveller",
      ownerName: "Robin Traveller",
      ownerNickname: "Robin Traveller",
      visibility: "guest",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF", // de-CH
    });
    const redeem = calls.find((c) => c.url === "/api/auth/links/redeem")!;
    expect(redeem.body).toEqual({ user: "robin", token: "link-token", for: "read" });
    expect(onSignedIn).toHaveBeenCalledWith("robin", true);
    // Never a trip write, and the draft is gone once the journal exists.
    expect(calls.some((c) => c.url.includes("/trips/"))).toBe(false);
    expect(sessionStorage.getItem("fs-signup-draft")).toBeNull();
  });

  describe("B-2845: the currency from the proven number and the time zone", () => {
    const withNumber = (tel: string) =>
      stubWizardFetch({
        ...baseRoutes,
        "GET /api/auth/signup/state": { ...STATE_NO_PHONE, phoneRequired: true, mode: "code" },
        "POST /api/auth/signup/phone": { __status: 202, id: "p1" },
        "POST /api/auth/signup/phone/redeem": { ok: true, tel },
      });
    async function toName() {
      await toToken();
      await type("signup-tel", "76 000 00 01");
      await submit();
      await type("signup-phone-code", "654321");
      await type("signup-name", "Robin", 450);
    }
    test("a Swiss number beats an en-GB browser: CHF, no question, with its source", async () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
      zone("Europe/Zurich");
      withNumber("41760000001");
      mount();
      await toName();
      expect(text()).toMatch(/Currency\s*CHF/);
      expect(text()).toContain("From your number (+41).");
      expect(text()).not.toContain("Which money do you count in?");
    });
    test("a number and a time zone that disagree ask, the number's currency preselected", async () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
      zone("Europe/London");
      withNumber("41760000001");
      mount();
      await toName();
      expect(text()).toContain("Which money do you count in?");
      expect(text()).toMatch(/Currency\s*CHF/);
      await click(button(/^GBP$/));
      expect(text()).toMatch(/Currency\s*GBP/);
    });
    test("with no number the time zone beats the language", async () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
      zone("Europe/Zurich");
      stubWizardFetch(baseRoutes);
      mount();
      await toToken();
      await type("signup-name", "Robin", 450);
      expect(text()).toMatch(/Currency\s*CHF/);
      expect(text()).toContain("From your time zone (Zurich).");
    });
  });

  test("with no browser region the currency is never guessed: Choose, and Create waits", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en"]);
    stubWizardFetch({ ...baseRoutes, "POST /api/v2/journals": CREATED });
    mount();
    await toToken();
    await type("signup-name", "Robin", 450);
    expect(text()).toMatch(/Currency\s*Choose/);
    expect(button(/Create my journal/).hasAttribute("disabled")).toBe(true);
    await click(button(/Edit advanced settings/));
    const select = input("signup-currency") as unknown as HTMLSelectElement;
    await act(async () => {
      select.value = "EUR";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(button(/Create my journal/).hasAttribute("disabled")).toBe(false);
    await submit();
    expect(calls.find((c) => c.url === "/api/v2/journals")!.body.baseCurrency).toBe("EUR");
  });

  test("advanced settings are honoured: search engines, language, title, address", async () => {
    stubWizardFetch({ ...baseRoutes, "POST /api/v2/journals": CREATED, "POST /api/auth/links/redeem": { ok: true } });
    mount();
    await toToken();
    await type("signup-name", "Robin", 450);
    await click(button(/Edit advanced settings/));
    expect(button(/Back to the summary/)).toBeTruthy();
    await click(input("signup-listed"));
    const lang = input("signup-locale") as unknown as HTMLSelectElement;
    await act(async () => {
      lang.value = "de";
      lang.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await type("signup-title", "Mein Journal");
    await type("signup-username", "robin-unterwegs", 450);
    await click(button(/Back to the summary/));
    expect(text()).toContain("Deutsch");
    expect(text()).toContain("May list it");
    await submit();
    const body = calls.find((c) => c.url === "/api/v2/journals")!.body;
    expect(body).toMatchObject({
      title: "Mein Journal",
      username: "robin-unterwegs",
      ownerName: "Robin",
      visibility: "public",
      defaultLocale: "de",
      locales: ["de"],
    });
  });

  test("an address refused at create returns to the form with the name kept and the reason shown", async () => {
    stubWizardFetch({ ...baseRoutes, "POST /api/v2/journals": { __status: 409, error: "username_taken" } });
    mount();
    await toToken();
    await type("signup-name", "Robin", 450);
    await submit();
    expect(text()).toMatch(/already being used by another journal/);
    expect(input("signup-name").value).toBe("Robin");
    expect(input("signup-username")).not.toBeNull();
  });

  // ── resume ──────────────────────────────────────────────────────────────
  test("resuming lands on the unfinished step with Welcome back", async () => {
    stubWizardFetch({
      ...inbound,
      "POST /api/auth/signup/identity": { token: "signup-token" },
    });
    mount({ email: "me@example.test", resume: true });
    await settle();
    expect(text()).toContain("Welcome back — your email is confirmed.");
    expect(button(/Open WhatsApp/)).toBeTruthy();
    expect(input("signup-email")).toBeNull();
  });

  test("a reload on the name step restores the fields from this tab's draft", async () => {
    sessionStorage.setItem("fs-signup-draft", JSON.stringify({ name: "Robin", listed: true, defaultLocale: "de" }));
    stubWizardFetch({ ...baseRoutes, "POST /api/auth/signup/identity": { token: "signup-token" } });
    mount({ email: "me@example.test", resume: true });
    await settle(450);
    expect(text()).toContain("Welcome back");
    expect(input("signup-name").value).toBe("Robin");
    expect(text()).toContain("May list it");
    expect(text()).toContain("Deutsch");
  });

  // ── what the form sends is what the journal becomes ─────────────────────
  /**
   * B838 again, from the other end: the journal that comes out of this form
   * has a switcher. `localesFor` reads the config the route writes.
   */
  test("the languages the form sends make a journal with a switcher", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-wizard-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "Fernscout", url: "https://example.test", defaultUser: "robin" },
        users: { reserved: [] },
        features: {},
      }),
    );
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();
    try {
      const created = createJournal({
        username: "robin",
        title: "Mein Journal",
        ownerEmail: "robin@example.test",
        ownerName: "Robin Traveller",
        ownerNickname: "Robin",
        visibility: "public",
        defaultLocale: "de",
        locales: ["de", "hu"],
        baseCurrency: "EUR",
      });
      expect(created.ok).toBe(true);
      clearUserCache();
      clearConfigCache();
      expect(localesFor("robin")).toEqual(["de", "hu"]);
    } finally {
      delete process.env.CONTENT_DIR;
      clearConfigCache();
      clearUserCache();
      clearLocaleCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

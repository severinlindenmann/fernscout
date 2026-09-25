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

/**
 * B688 — a visitor with no journal, now at `/welcome` (B2170).
 *
 * No network call anywhere here: `global.fetch` is stubbed with the exact
 * shapes `/api/auth/codes` and `/api/auth/codes/redeem` (both `for: "signup"`)
 * and `/api/v1/journals` already answer with, so what is under test is the
 * component reading those answers — not the routes themselves, which have
 * their own tests (`test/signup-token.test.ts`, `paid/test/signup-credit-grant.test.ts`).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function withLocale(node: React.ReactNode) {
  return <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>{node}</LocaleProvider>;
}

describe("the signup wizard", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  function input(id: string): HTMLInputElement {
    return container!.querySelector(`#${id}`) as HTMLInputElement;
  }

  function form(): HTMLFormElement {
    return container!.querySelector("form") as HTMLFormElement;
  }

  async function submit() {
    await act(async () => {
      form().requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  test("surfaces a reserved username's own reason, in words", async () => {
    const responses: Array<{ ok: boolean; json: () => Promise<unknown> }> = [
      { ok: true, json: async () => ({ status: "accepted" }) }, // signup/request
      { ok: true, json: async () => ({ ok: true, token: "signup-token" }) }, // signup/verify
      {
        ok: false,
        json: async () => ({
          error: "reserved_username",
          message: '"agent" is reserved by this server — it would shadow one of its own routes.',
        }),
      }, // POST /api/v1/journals
    ];
    const fetchMock = vi.fn(() => Promise.resolve(responses.shift()!));
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(<SignupWizard locale="en" codeMinutes="20" onSignedIn={() => {}} onAlreadyOwns={() => {}} />),
      );
    });

    typeInto(input("signup-email"), "new@example.test");
    await submit();

    typeInto(input("signup-code"), "123456");
    await submit();

    typeInto(input("signup-title"), "My Journal");
    typeInto(input("signup-username"), "agent");
    typeInto(input("signup-owner-name"), "Robin Traveller");
    typeInto(input("signup-owner-nickname"), "Robin");
    // B839 — the form will not submit without it.
    typeInto(input("signup-currency"), "EUR");
    await submit();

    // B1250 — the wizard renders its own person-facing sentence for a known
    // cause, not the API's machine-facing message (which names routes and
    // tokens for an agent reading it, not a person).
    expect(container!.textContent).toMatch(/is reserved on this server/);
    // No network call ever left this test — every response above was a stub.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  /**
   * B838 — the two language questions, and the one that was hardcoded.
   *
   * `locales: [defaultLocale]` on line 139 meant every journal the helper
   * created had no switcher, which is B277 reproduced by construction. What
   * this asserts is the whole of the fix: the body carries the languages the
   * person ticked, not one derived from the browser they happen to be
   * holding.
   */
  test("sends the languages chosen, not the one the browser was in", async () => {
    const responses: Array<{ ok: boolean; json: () => Promise<unknown> }> = [
      { ok: true, json: async () => ({ status: "accepted" }) },
      { ok: true, json: async () => ({ ok: true, token: "signup-token" }) },
      {
        ok: true,
        json: async () => ({
          ok: true,
          token: "agent-token",
          user: "robin",
          signIn: "",
          url: "https://example.test/robin",
        }),
      },
    ];
    // Typed, because this test reads the request body back out — which is
    // the whole assertion: what the form *sent*, not what it drew.
    const fetchMock = vi.fn((_url: string, init?: { body?: string }) =>
      Promise.resolve(responses.shift()!),
    );
    vi.stubGlobal("fetch", fetchMock);

    root = createRoot(container!);
    act(() => {
      // The browser is in English; the person writes in German and wants a
      // Hungarian switcher. Neither answer is guessable from `locale`.
      root!.render(
        withLocale(<SignupWizard locale="en" codeMinutes="20" onSignedIn={() => {}} onAlreadyOwns={() => {}} />),
      );
    });

    typeInto(input("signup-email"), "new@example.test");
    await submit();
    typeInto(input("signup-code"), "123456");
    await submit();

    for (const [id, value] of [
      ["signup-title", "Mein Journal"],
      ["signup-username", "robin"],
      ["signup-owner-name", "Robin Traveller"],
      ["signup-owner-nickname", "Robin"],
      ["signup-currency", "EUR"],
    ] as const) {
      typeInto(input(id), value);
    }

    function radio(name: string, value: string): HTMLInputElement {
      return container!.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement;
    }
    await act(async () => {
      radio("signup-locale", "de").click();
    });
    await act(async () => {
      radio("signup-reader-locales", "hu").click();
    });
    await submit();

    const body = JSON.parse(fetchMock.mock.calls[2][1]?.body ?? "{}") as Record<string, unknown>;
    expect(body.defaultLocale).toBe("de");
    expect(body.locales).toEqual(["de", "hu"]);
    // B839 — asked, not defaulted to the francs `createJournal` used to write.
    expect(body.baseCurrency).toBe("EUR");
    // B1292 — once the journal exists the pitch is not shown again. B2170
    // removed the trip step that used to print the journal's address here;
    // what follows a create now is signing in and handing over to the page.
    expect(container!.textContent).not.toMatch(/Start your own journal/);
    expect(container!.textContent).toContain("Signing you in");
  });

  /**
   * B838 again, from the other end: the journal that comes out of this form
   * has a switcher, which is the thing B277 found missing. `localesFor`
   * reads the config the route writes, so this is the property the ticket
   * actually asks for rather than a restatement of the request body.
   */
  test("two languages ticked is a journal with a switcher", async () => {
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
        // Exactly what the form now sends.
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

  /**
   * B2170 — the wizard ends at the journal. The trip step (B1674) went: the
   * studio's "A new trip" makes the first trip. What this pins is the end of
   * the flow: the create answer's one-press link is spent for a session,
   * the username is handed to the page, and nothing writes a trip.
   */
  test("the journal step signs in and hands over; no trip is written", async () => {
    const responses: Array<{ ok: boolean; json: () => Promise<unknown> }> = [
      { ok: true, json: async () => ({ status: "accepted" }) }, // codes
      { ok: true, json: async () => ({ ok: true, token: "signup-token" }) }, // codes/redeem
      {
        ok: true,
        json: async () => ({
          ok: true,
          token: "agent-token",
          user: "robin",
          // \`signInUrl\` appends the journal's language; B2170 found it sent as
          // part of the token.
          signIn: "https://example.test/robin/s/link-token?lang=en",
          url: "https://example.test/robin",
        }),
      }, // POST /api/v2/journals
      { ok: true, json: async () => ({ ok: true }) }, // links/redeem
    ];
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(responses.shift()!));
    vi.stubGlobal("fetch", fetchMock);
    const onSignedIn = vi.fn();

    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(<SignupWizard locale="en" codeMinutes="20" onSignedIn={onSignedIn} onAlreadyOwns={() => {}} />),
      );
    });

    typeInto(input("signup-email"), "new@example.test");
    await submit();
    typeInto(input("signup-code"), "123456");
    await submit();
    for (const [id, value] of [
      ["signup-title", "My Journal"],
      ["signup-username", "robin"],
      ["signup-owner-name", "Robin Traveller"],
      ["signup-owner-nickname", "Robin"],
      ["signup-currency", "EUR"],
    ] as const) {
      typeInto(input(id), value);
    }
    await submit();
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url).toBe("/api/auth/links/redeem");
    expect(JSON.parse(String(init.body))).toEqual({ user: "robin", token: "link-token", for: "read" });
    // Never a bearer token on the sign-in call, and never a trip write.
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    for (const [calledUrl, calledInit] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(calledUrl).not.toContain("/trips/");
      expect(calledInit.method).toBe("POST");
    }
    expect(onSignedIn).toHaveBeenCalledWith("robin", true);
  });
});

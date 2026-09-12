// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AgentDoor from "@/components/AgentDoor";
import SignupWizard from "@/components/SignupWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { clearLocaleCache, dictionaryFor, localesFor } from "@/lib/locales";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { typeInto } from "./support/type-input";

/**
 * B688 — a visitor with no journal, inside `/agent`.
 *
 * No network call anywhere here: `global.fetch` is stubbed with the exact
 * shapes `/api/auth/signup/request`, `/api/auth/signup/verify` and
 * `/api/v1/journals` already answer with, so what is under test is the
 * component reading those answers — not the routes themselves, which have
 * their own tests (`test/signup-token.test.ts`, `test/signup-credit-grant.test.ts`).
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

describe("the door, with signup off", () => {
  test("a signed-in reader with no journal gets a plain sentence, not a form", () => {
    const html = renderToStaticMarkup(
      withLocale(
        <AgentDoor
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          codeMinutes="20"
          signedIn
          identityEmail="reader@example.test"
          signupEnabled={false}
          siteName="T"
        />,
      ),
    );
    expect(html).not.toContain("<form");
    expect(html).toContain("don&#x27;t own a journal");
  });

  test("a visitor who is not signed in either sees no signup form, just the sentence", () => {
    const html = renderToStaticMarkup(
      withLocale(
        <AgentDoor
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          codeMinutes="20"
          signedIn={false}
          identityEmail={null}
          signupEnabled={false}
          siteName="T"
        />,
      ),
    );
    // IdentitySignIn's own form is unaffected — this asserts the *signup*
    // form specifically is absent, not that the page has no form at all.
    expect(html).not.toContain("signup-username");
    expect(html).toContain("switched on here");
  });
});

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
    // B1292 — the trip step confirms the journal that create just made,
    // rather than showing the "New here?" pitch again with nothing said
    // about the success that just happened.
    expect(container!.textContent).not.toMatch(/New here\?/);
    expect(container!.textContent).toContain("https://example.test/robin");
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
});

/**
 * B804 — a 71-year-old read "Gib das deinem Agenten" as her next
 * instruction, because nothing on the screen said the block below the form
 * was not for her. The panel stays (B681 put it here whether the helper is
 * on or off); what it now has in front of it is one plain sentence that ends
 * in permission to ignore it.
 */
describe("the bring-your-own-agent panel, for somebody who has no agent", () => {
  function door(locale: string) {
    return renderToStaticMarkup(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <AgentDoor
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          codeMinutes="20"
          signedIn={false}
          identityEmail={null}
          signupEnabled
          siteName="T"
        />
      </LocaleProvider>,
    );
  }

  test("the German line offers it and then lets somebody off it", () => {
    const html = door("de");
    expect(html).toContain("Benutzt du schon ein Programm wie ChatGPT?");
    // The half that matters: permission, not another instruction.
    expect(html).toContain("sonst brauchst du das nicht");
  });

  test("the panel is still on the page, one tap behind that line", () => {
    const html = door("de");
    // Collapsed, not removed — B804 is explicit that it must not move off
    // the page. `<summary>` is what makes it a disclosure rather than a
    // sentence somebody has to act on.
    expect(html).toContain("<summary");
    expect(html).toContain("https://example.test/agent.md");
  });
});

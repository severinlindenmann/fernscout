// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import AgentDoor from "@/components/AgentDoor";
import SignupWizard from "@/components/SignupWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

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
          siteUrl="https://example.test"
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          codeMinutes="20"
          signedIn
          identityEmail="reader@example.test"
          signupEnabled={false}
          journals={[]}
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
          siteUrl="https://example.test"
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          codeMinutes="20"
          signedIn={false}
          identityEmail={null}
          signupEnabled={false}
          journals={[]}
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
        withLocale(<SignupWizard locale="en" codeMinutes="20" onSignedIn={() => {}} />),
      );
    });

    input("signup-email").value = "new@example.test";
    input("signup-email").dispatchEvent(new Event("input", { bubbles: true }));
    await submit();

    input("signup-code").value = "123456";
    input("signup-code").dispatchEvent(new Event("input", { bubbles: true }));
    await submit();

    input("signup-title").value = "My Journal";
    input("signup-title").dispatchEvent(new Event("input", { bubbles: true }));
    input("signup-username").value = "agent";
    input("signup-username").dispatchEvent(new Event("input", { bubbles: true }));
    input("signup-owner-name").value = "Robin Traveller";
    input("signup-owner-name").dispatchEvent(new Event("input", { bubbles: true }));
    input("signup-owner-nickname").value = "Robin";
    input("signup-owner-nickname").dispatchEvent(new Event("input", { bubbles: true }));
    await submit();

    expect(container!.textContent).toMatch(/reserved by this server/);
    // No network call ever left this test — every response above was a stub.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

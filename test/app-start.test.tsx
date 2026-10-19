// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import Landing from "@/components/Landing";
import type { InviteCta } from "@/components/landing/SignedOut";
import { dictionaryFor } from "@/lib/locales";

/**
 * B-3012 — the signed-out `/` inside the iPhone app is one screen with the
 * instance's one primary door and the way in; the website keeps its pitch.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v2/me/home") {
        return new Response(JSON.stringify({ id: null, email: null, journals: [], devices: [], admin: false }));
      }
      if (url === "/api/auth/identity/upgrade") return new Response(JSON.stringify({ ok: true, issued: false }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(inviteCta: InviteCta, native: boolean) {
  if (native) (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
  root = createRoot(host);
  act(() =>
    root.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <Landing
          siteName="Fernscout"
          docUrl="https://example.test/documentation.txt"
          agentUrl="https://example.test/agent.md"
          journals={[]}
          codeMinutes="30"
          inviteCta={inviteCta}
          pricing={<section id="prices">Pricing table</section>}
        />
      </LocaleProvider>,
    ),
  );
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const en = dictionaryFor("en");
const links = () => [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);

describe("the iPhone app's start screen", () => {
  test("open signup: start a journal and sign in, nothing of the pitch", async () => {
    await render("welcome", true);
    expect(links()).toContain("/welcome");
    expect(buttons()).toContain(en["landing.signIn"]);
    expect(host.textContent).toContain(en["landing.app.signInNote"]);
    expect(host.textContent).not.toContain("Pricing table");
    expect(host.querySelector("#how")).toBeNull();
  });

  test("invite only: the primary door asks for an invite", async () => {
    await render("request", true);
    expect(links()).toContain("/invite");
    expect(links()).not.toContain("/?start=1");
    expect(buttons()).toContain(en["landing.signIn"]);
  });

  test("no new journals: only the way in", async () => {
    await render("none", true);
    expect(links()).not.toContain("/welcome");
    expect(links()).not.toContain("/invite");
    expect(buttons()).toContain(en["landing.signIn"]);
  });

  test("sign in opens the form full screen, and back returns", async () => {
    await render("welcome", true);
    const signIn = [...host.querySelectorAll("button")].find((b) => b.textContent === en["landing.signIn"])!;
    act(() => signIn.click());
    expect(host.querySelector("input")).not.toBeNull();
    expect(links()).not.toContain("/welcome");
    act(() => (host.querySelector(`button[aria-label="${en["landing.navHome"]}"]`) as HTMLButtonElement).click());
    expect(links()).toContain("/welcome");
  });

  test("in a browser the website's page is unchanged", async () => {
    await render("welcome", false);
    expect(host.textContent).toContain("Pricing table");
    expect(host.textContent).not.toContain(en["landing.app.signInNote"]);
  });
});

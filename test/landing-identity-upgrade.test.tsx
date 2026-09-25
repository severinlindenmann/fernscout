// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import Landing from "@/components/Landing";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1493 — a reader signed into a journal before B410 (or whose identity was
 * cleared) holds `fs_session` and no `fs_identity`. `/api/v2/me/home`
 * answers from the identity alone (`lib/auth/handshake.ts`), so the first
 * probe on `/` comes back `id: null` — exactly the shape a genuine stranger
 * gets. The landing page has to tell the two apart by trying the same
 * upgrade `IdentityUpgrade` already performs on a journal's own page
 * (`POST /api/auth/identity/upgrade`) before it decides nobody is signed in.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const landing = (
  <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
    <Landing
      siteName="Fernscout"
      docUrl="https://example.test/documentation.txt"
      agentUrl="https://example.test/agent.md"
      journals={[]}
      codeMinutes="30"
    />
  </LocaleProvider>
);

async function flush() {
  // Two microtask turns per fetch in the chain (response, then .json()), and
  // this test's chain is three fetches deep.
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("the root page's identity-upgrade retry", () => {
  test("a journal session with no identity yet is still shown its journals", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/v2/me/home") {
          const already = calls.filter((c) => c.endsWith("/api/v2/me/home")).length;
          if (already === 1) {
            return new Response(JSON.stringify({ id: null, email: null, journals: [], devices: [], admin: false }));
          }
          return new Response(
            JSON.stringify({
              id: "pub1",
              email: "ana@example.test",
              admin: false,
              journals: [
                {
                  username: "ana",
                  title: "Two Backpacks",
                  tagline: "A tagline",
                  href: "/ana",
                  role: "owner",
                  trips: [],
                },
              ],
              devices: [],
            }),
          );
        }
        if (url === "/api/auth/identity/upgrade") {
          return new Response(JSON.stringify({ ok: true, issued: true }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    root = createRoot(host);
    act(() => root.render(landing));
    await flush();

    expect(calls).toEqual([
      "GET /api/v2/me/home",
      "POST /api/auth/identity/upgrade",
      "GET /api/v2/me/home",
    ]);
    expect(host.textContent).toContain("Two Backpacks");
    expect(host.textContent).toContain("Signed in as");
  });

  test("a genuine stranger — the upgrade issues nothing — still sees the signed-out page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v2/me/home") {
          return new Response(JSON.stringify({ id: null, email: null, journals: [], devices: [], admin: false }));
        }
        if (url === "/api/auth/identity/upgrade") {
          // B1727 — what the route actually answers an empty jar now: an
          // answer rather than a refusal. `issued: false` is still what
          // stops the probe, which is the thing this keeper is about.
          return new Response(JSON.stringify({ ok: true, issued: false }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    root = createRoot(host);
    act(() => root.render(landing));
    await flush();

    expect(host.textContent).toContain("Sign in to read");
    expect(host.textContent).not.toContain("Your journals");
  });
});

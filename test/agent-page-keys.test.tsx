// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import AgentPageContent from "@/app/[user]/studio/agent/AgentPageContent";
import AgentKeys from "@/components/AgentKeys";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2091 — the studio's agent page. Its intro sentence printed twice (the
 * page's lede and the handover block's own paragraph); Revoke removed a key
 * on one tap; and two keys read the same, with nothing to tell them apart.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/studio/agent",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const en = dictionaryFor("en");

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe("the agent page", () => {
  test("the intro sentence appears once", () => {
    // B2142: the page's lede is its own sentence now; the handover block's
    // intro paragraph stays off.
    const page = fs.readFileSync(path.join(process.cwd(), "app/[user]/studio/agent/page.tsx"), "utf8");
    expect(page).toMatch(/lede=\{translateIn\(locale, "studio\.permissions\.lede"\)\}/);
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={en}>
        <AgentPageContent username="alex" permissions={[]} />
      </LocaleProvider>,
    );
    expect(html).toContain(en["me.handoverCreate"]);
    expect(html).not.toContain(en["me.agentBody"]);
  });

  test("Revoke asks first, names the key by when it was made, and revokes only on confirm", async () => {
    const createdAt = new Date();
    createdAt.setHours(21, 3, 0, 0);
    const key = {
      id: "k1",
      kind: "handover",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 20 * 60_000).toISOString(),
      lastSeenAt: null,
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ keys: [key] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <LocaleProvider locale="en" dictionary={en}>
          <AgentKeys username="alex" />
        </LocaleProvider>,
      );
    });

    const made = createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(container.textContent).toContain(`made ${made}`);

    const revoke = [...container.querySelectorAll("button")].find((b) => b.textContent === en["me.keysRevoke"])!;
    act(() => revoke.click());
    const panel = container.querySelector('[role="dialog"]');
    expect(panel?.textContent).toContain(made);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    const confirm = [...panel!.querySelectorAll("button")].find((b) => b.textContent === en["me.keysRevokeConfirm"])!;
    await act(async () => confirm.click());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});

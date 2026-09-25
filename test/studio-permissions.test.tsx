// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import AgentPageContent, { type PermissionRow } from "@/app/[user]/studio/agent/AgentPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2142 — the Agent page becomes "Permissions & keys": four switches for
 * what leaves this server, and a collapsed Keys section. No duplicated
 * intro, no prompt block on the page itself.
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

const ROWS: PermissionRow[] = [
  { id: "words", granted: ["words", "statement"], provider: "Anthropic" },
  { id: "speech", granted: [], provider: "Deepgram" },
  { id: "photos", granted: [], provider: "Anthropic" },
  { id: "sessions", granted: ["sessions"], provider: "Fernscout" },
];

async function mount(rows = ROWS) {
  const calls: { method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/consent")) calls.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, keys: [] }), { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider locale="en" dictionary={en}>
        <AgentPageContent username="alex" permissions={rows} />
      </LocaleProvider>,
    ),
  );
  return calls;
}

const switches = () => [...container!.querySelectorAll('[role="switch"]')] as HTMLButtonElement[];

describe("Permissions & keys", () => {
  test("four switches, each naming who it goes to; the ungranted ones off and waiting for the import", async () => {
    await mount();
    expect(switches()).toHaveLength(4);
    expect(switches().map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "true"]);
    const text = container!.querySelector("[data-permissions]")!.textContent!;
    expect(text).toContain("Anthropic");
    expect(text).toContain("Deepgram");
    expect(text).toContain(en["studio.permissions.sessions.title"]);
    // Only the import's own panel grants what goes to a model.
    expect(switches()[1].disabled).toBe(true);
    expect(switches()[2].disabled).toBe(true);
    expect(text.split(en["studio.permissions.asksWhenNeeded"]).length - 1).toBe(2);
  });

  test("no duplicate intro and no prompt block; Keys is collapsed", async () => {
    await mount();
    const page = fs.readFileSync(path.join(process.cwd(), "app/[user]/studio/agent/page.tsx"), "utf8");
    expect(page).toMatch(/lede=\{translateIn\(locale, "studio\.permissions\.lede"\)\}/);
    expect(container!.textContent).not.toContain(en["me.agentBody"]);
    expect(container!.querySelector("pre")).toBeNull();
    const keys = container!.querySelector("details[data-keys]") as HTMLDetailsElement;
    expect(keys.open).toBe(false);
    expect(keys.textContent).toContain(en["me.handoverCreate"]);
    expect(keys.textContent).toContain(en["me.tokenTitle"]);
  });

  test("switching words off withdraws words and the statement headings, through the consent route", async () => {
    const calls = await mount();
    await act(async () => switches()[0].click());
    expect(calls).toEqual([
      { method: "DELETE", body: { scope: "words" } },
      { method: "DELETE", body: { scope: "statement" } },
    ]);
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(switches()[0].disabled).toBe(true);
  });

  test("the conversations switch goes both ways", async () => {
    const calls = await mount();
    await act(async () => switches()[3].click());
    await act(async () => switches()[3].click());
    expect(calls).toEqual([
      { method: "DELETE", body: { scope: "sessions" } },
      { method: "POST", body: { scope: "sessions" } },
    ]);
    expect(switches()[3].getAttribute("aria-checked")).toBe("true");
  });

  test("the page folds statement into the words row and names today's recipient", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/[user]/studio/agent/page.tsx"), "utf8");
    expect(page).toMatch(/id: "words", granted: \(\["words", "statement"\] as const\)\.filter\(has\)/);
    expect(page).toMatch(/currentHelperProvider\("speech"\)/);
  });
});

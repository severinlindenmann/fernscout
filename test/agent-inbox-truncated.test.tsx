// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import AgentInbox from "@/components/AgentInbox";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { InboxItem } from "@/lib/helper/server";

/**
 * B759 — a statement with more rows than `SHOWN` in
 * `app/api/helper/[user]/statement/apply/route.ts` reports `truncated`, and
 * the screen used to throw that number away (`setRows((body.spending ?? [])
 * as Row[])` never read `body.truncated`). Reconciling a statement against a
 * bank app then finds a shortfall with no explanation.
 *
 * Same jsdom + `createRoot` harness as `test/helper-chat.test.tsx`.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const dictionary = dictionaryFor("en");

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const item: InboxItem = {
  entry: {
    id: "statement-1",
    kind: "files",
    filename: "statement.csv",
    bytes: 2048,
    sha256: "deadbeef",
    uploadedAt: new Date().toISOString(),
  },
  offer: { kind: "statement", format: "known-bank", label: "A known bank" },
};

function render(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body }) as Response),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <AgentInbox
          username="alex"
          items={[item]}
          trips={[{ id: "trip-1", title: "A trip", start: "2026-01-01", end: "2026-01-10" }]}
          dedicatedImporters={[]}
          helper={{ enabled: true, consented: true, credits: 5 }}
        />
      </LocaleProvider>,
    );
  });
}

function click(text: string) {
  const found = Array.from(container!.querySelectorAll("button")).find((one) =>
    (one.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`no button saying "${text}" in: ${container!.textContent}`);
  act(() => found.click());
}

describe("a statement longer than the cap", () => {
  test("says how many rows were left off the screen", async () => {
    render({
      ok: true,
      read: 600,
      outside: 0,
      spending: Array.from({ length: 400 }, (_, i) => ({
        date: "2026-01-02",
        label: `payment ${i}`,
        amount: 10,
        currency: "CHF",
      })),
      truncated: 200,
    });

    // Open the item, accept the known format, then trigger the whole-file read.
    click(dictionary["agent.inboxStatement"]);
    click(dictionary["agent.inboxReadAll"]);
    await act(async () => {
      click(dictionary["agent.inboxReadAll"]);
      await Promise.resolve();
    });

    expect(container!.textContent).toContain(
      dictionary["agent.inboxTruncated"].replace("{count}", "200"),
    );
  });

  test("says nothing when the statement fit on the screen", async () => {
    render({
      ok: true,
      read: 3,
      outside: 0,
      spending: [{ date: "2026-01-02", label: "coffee", amount: 4, currency: "CHF" }],
      truncated: 0,
    });

    click(dictionary["agent.inboxStatement"]);
    click(dictionary["agent.inboxReadAll"]);
    await act(async () => {
      click(dictionary["agent.inboxReadAll"]);
      await Promise.resolve();
    });

    expect(container!.textContent).not.toContain("were read from this statement");
  });
});

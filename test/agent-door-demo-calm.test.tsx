// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * B1221 — the door's own calm rule ("one bright thing that can be pressed",
 * `components/RoomOpening.tsx`'s own comment on B1021) has to survive adding
 * the demo trigger. `test/agent-door-calm.test.tsx` is the ticket's named
 * guard for this and does not exist in this checkout (B1219 builds it
 * concurrently, on its own branch); this makes the same assertion directly
 * against `AgentDoor`, so the property is checked here regardless of which
 * session's file lands first.
 *
 * `AgentDoor` with `signedIn={false}` and `signupEnabled={true}` renders the
 * "have a journal?" choice — the door's one bright (yellow) button — before
 * anything is picked, plus a second, hidden `bg-yellow-400` button that was
 * already there before this ticket: `CopyLine`'s copy-link button, inside
 * `AgentBlock` behind the closed "bring your own agent" `<details>`. That is
 * the honest baseline, so this test compares against it rather than hardcoding
 * a count that is not this ticket's to fix. The demo trigger and its "Play
 * again"/"Close" controls are quiet underlined text, the same shape as
 * "why?", and the mock proposal's accept button inside the transcript is
 * `disabled` and not a live control (see `components/DoorDemo.tsx`), so
 * opening and playing the demo must not add to that baseline.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.useRealTimers();
});

async function mountDoor() {
  const { default: AgentDoor } = await import("@/components/AgentDoor");
  const { default: LocaleProvider } = await import("@/components/LocaleProvider");
  const { dictionaryFor } = await import("@/lib/locales");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <AgentDoor
          docUrl="https://example.test/agent.md"
          agentUrl="https://example.test"
          codeMinutes="30"
          signedIn={false}
          identityEmail={null}
          signupEnabled={true}
          siteName="Fernscout"
        />
      </LocaleProvider>,
    );
  });
}

function yellowButtons(): Element[] {
  return [...container!.querySelectorAll("button")].filter((b) =>
    b.className.includes("bg-yellow-400"),
  );
}

describe("the door stays calm with the demo on it", () => {
  test("opening and playing the demo through adds no bright button", async () => {
    vi.useFakeTimers();
    await mountDoor();
    // Whatever the door renders before the demo is touched — including the
    // closed `<details>` copy-link button `AgentBlock` carries — is the
    // baseline this ticket must not add to.
    const before = yellowButtons().length;
    expect(before).toBeGreaterThan(0);

    const trigger = [...container!.querySelectorAll("button")].find(
      (b) => b.textContent === "See how it works",
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());
    act(() => vi.runAllTimers());

    expect(yellowButtons()).toHaveLength(before);
    // The demo's own controls are quiet text links, not a second call to
    // action.
    const replay = [...container!.querySelectorAll("button")].find(
      (b) => b.textContent === "Play again",
    );
    expect(replay?.className).toContain("underline");
  });
});

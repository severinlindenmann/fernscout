// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import InviteRedeem from "@/components/InviteRedeem";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1410 — a returning reader who already holds a proven address (a session
 * or an `fs_identity` cookie for a *different* journal) lands on the
 * "confirm" step: a form with nothing left to fill in, and a submit button
 * that only fires on a press nobody was told to make. Closing the tab there
 * left no `contacts` row and no `contact_invites.uses` bump — the redeem POST
 * was simply never sent. The fix auto-submits that step once, from the
 * initial render, keeping the button only as a manual retry.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

const dictionaries = { en: dictionaryFor("en") };

async function render(knownEmail: string | null, alreadyIn = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <InviteRedeem
        username="ana"
        journalTitle="Ana's journal"
        kind="buddy"
        tripTitle="Algarve"
        token="tok"
        initialLocale="en"
        locales={["en"]}
        dictionaries={dictionaries}
        knownEmail={knownEmail}
        initialName="Vika"
        invitedEmail={null}
        alreadyIn={alreadyIn}
      />,
    );
  });
}

test("a returning, already-known reader is redeemed without pressing anything (B1410)", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: "waiting" }),
  });
  vi.stubGlobal("fetch", fetchMock);

  await render("known@example.test");

  // Fired from the effect alone — no click, no submit.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/contacts/redeem");
  // The owner's approval screen, reached with no press — proof the request
  // that used to never leave the browser now completes on its own.
  expect(container!.textContent).toContain(
    dictionaries.en["invite.waitingTitle"],
  );
});

test("a brand-new reader (no known address) still has to press the button", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await render(null);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(container!.querySelector('input[id="invite-name"]')).not.toBeNull();
});

test("somebody who already has everything this link leads to is not redeemed again", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await render("known@example.test", true);

  expect(fetchMock).not.toHaveBeenCalled();
});

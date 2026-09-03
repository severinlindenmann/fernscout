import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FeatureName } from "@/lib/config";

/**
 * B74 — where the panel's answer about contacts comes from.
 *
 * `isEnabled` reads server config, and the panel is a client component, so the
 * question has to be asked in `app/[user]/me/page.tsx` and travel as a prop.
 * The bug was that it was asked once, for `manageHref`, and not again for the
 * owner's link to the guest list — which then pointed at a page that answers
 * 404 whenever the journal has contacts off.
 *
 * This asserts the wiring rather than the markup: what the server page hands
 * down. `test/access-panel.test.tsx` covers what the panel then draws with it.
 */

const enabled = vi.fn<(name: FeatureName, username?: string) => boolean>(() => true);

vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: FeatureName, username?: string) => enabled(name, username),
}));
vi.mock("@/lib/users", () => ({
  getUser: () => ({ title: "Alex's journal", owner: { email: "owner@example.test" } }),
}));
vi.mock("@/lib/viewer", () => ({
  resolveViewer: async () => ({ email: null, owner: true, guest: false, trips: [] }),
}));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ url: "https://example.test" }) }));
vi.mock("@/lib/contacts", () => ({
  listContacts: async () => [],
  manageTokenFor: () => "t",
  normaliseEmail: (email: string) => email,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

async function propsOf(user = "alex") {
  const { default: MePage } = await import("@/app/[user]/me/page");
  const element = (await MePage({
    params: Promise.resolve({ user }),
  } as Parameters<typeof MePage>[0])) as { props: Record<string, unknown> };
  return element.props;
}

beforeEach(() => {
  enabled.mockReset();
});

describe("what the me page tells the panel about contacts", () => {
  test("passes the capability down, resolved for this journal", async () => {
    enabled.mockImplementation(() => true);
    expect((await propsOf()).contactsEnabled).toBe(true);
    expect(enabled).toHaveBeenCalledWith("contacts", "alex");
  });

  test("and says no when the journal has it off, so no link is drawn", async () => {
    enabled.mockImplementation((name) => name !== "contacts");
    const props = await propsOf();
    expect(props.contactsEnabled).toBe(false);
    // The other capability on the page is a separate question and unaffected.
    expect(props.canSignIn).toBe(true);
  });
});

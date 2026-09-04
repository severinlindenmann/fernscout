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
/** The journal as its config holds it — a name, a short form, and the address
 * that must not travel with them (B20). */
const JOURNAL = {
  title: "Alex's journal",
  owner: { name: "Robin Berger", nickname: "Robin", email: "owner@example.test" },
};
vi.mock("@/lib/users", () => ({ getUser: () => JOURNAL }));
vi.mock("@/lib/viewer", () => ({
  resolveViewer: async () => ({ email: null, owner: true, guest: false, trips: [] }),
}));
/** Spied rather than reimplemented: what this file asserts is that the page
 * asks for the owner's short name and passes *that* down, not what the answer
 * is. `test/site-travellers.test.ts` owns the answer. */
const shortName = vi.hoisted(() => vi.fn((_user: unknown) => "Robin"));
vi.mock("@/lib/site", () => ({
  serverSite: () => ({ url: "https://example.test" }),
  ownerShortName: (user: unknown) => shortName(user),
}));
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

/**
 * `searchParams` is passed because Next always passes it, and since B142 the
 * page reads it — `?signin=expired` is how somebody whose welcome link was
 * spent by their own mail provider is told what happened. The cast is what
 * kept this helper compiling while it was one prop short.
 */
async function propsOf(user = "alex", searchParams: Record<string, string> = {}) {
  const { default: MePage } = await import("@/app/[user]/me/page");
  const element = (await MePage({
    params: Promise.resolve({ user }),
    searchParams: Promise.resolve(searchParams),
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

/**
 * B142. `?signin=expired` has been redirected to since the sign-in link
 * existed, and nothing on the page ever said anything about it — so somebody
 * whose welcome link had been spent by their own mail provider landed on an
 * ordinary page with no explanation and every reason to think they had done
 * something wrong.
 */
describe("why the reader landed on /me rather than in the journal", () => {
  test("a spent link is explained, and a throttle is a different sentence", async () => {
    enabled.mockReturnValue(true);
    expect((await propsOf("alex", { signin: "expired" })).signinNotice).toBe("me.signinExpired");
    expect((await propsOf("alex", { signin: "throttled" })).signinNotice).toBe(
      "me.signinThrottled",
    );
  });

  test("an ordinary visit says nothing, and neither does an invented value", async () => {
    enabled.mockReturnValue(true);
    expect((await propsOf("alex")).signinNotice).toBeUndefined();
    // The parameter selects one of two known keys or nothing at all — it never
    // becomes text, so it cannot be used to put a sentence on somebody's page.
    expect((await propsOf("alex", { signin: "<script>alert(1)</script>" })).signinNotice)
      .toBeUndefined();
  });
});

/**
 * B20 — the stranger is told who to ask, and nothing more about them.
 *
 * The name is picked here, at the server boundary, rather than by handing the
 * component the config object and choosing inside it: `owner.email` sits in
 * the same object, and a later edit to a client component should not be able
 * to reach a field it was never meant to have.
 */
describe("what the me page tells the panel about its owner", () => {
  test("hands down a short name, asked for by the page itself", async () => {
    enabled.mockReturnValue(true);
    const props = await propsOf();
    expect(props.ownerName).toBe("Robin");
    expect(shortName).toHaveBeenCalledWith(JOURNAL);
  });

  test("and nothing else about them — the address never becomes a prop", async () => {
    enabled.mockReturnValue(true);
    const props = await propsOf();
    expect(JSON.stringify(props)).not.toContain("owner@example.test");
    expect(props).not.toHaveProperty("owner");
    expect(props).not.toHaveProperty("ownerEmail");
  });
});

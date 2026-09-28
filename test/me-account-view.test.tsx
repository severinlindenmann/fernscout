// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import AccountPage from "@/app/me/AccountPage";
import Landing from "@/components/Landing";
import { dictionaryFor } from "@/lib/locales";

/**
 * `/me` as a signed-in reader sees it, and what moved off `/` to make room.
 *
 * Every role is listed with the one next door it has (studio for an owner,
 * the journal's own page for everybody else); devices are here and no longer
 * on the home page; and "sign out everywhere" asks before it acts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/me",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const HOME = {
  id: "pub-1",
  email: "oma@example.test",
  admin: false,
  journals: [
    { username: "ana", title: "Nordwärts", tagline: "", href: "/@ana", role: "owner", trips: [] },
    {
      username: "bea",
      title: "Béla's journal",
      tagline: "",
      href: "/@bea",
      role: "traveller",
      trips: [{ id: "balkan", title: "Balkan", href: "/@bea/trips/balkan", through: "traveller" }],
    },
    { username: "cleo", title: "Cleo reads", tagline: "", href: "/@cleo", role: "guest", trips: [] },
  ],
  devices: [
    { id: "d1", createdAt: "2026-09-01", lastSeenAt: "2026-09-27T10:00:00Z", userAgent: "Macintosh Chrome", current: true },
    { id: "d2", createdAt: "2026-09-02", lastSeenAt: null, userAgent: "iPhone Safari", current: false },
  ],
};

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

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function serve(home: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v2/me/home") return new Response(JSON.stringify(home));
      if (url === "/api/auth/identity/upgrade") return new Response(JSON.stringify({ ok: true, issued: false }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

const page = (
  <LocaleProvider locale="en" dictionary={dictionaryFor("en", "account")}>
    <AccountPage codeMinutes="30" />
  </LocaleProvider>
);

describe("/me, signed in", () => {
  test("lists every role with its own next door, and the devices", async () => {
    serve(HOME);
    root = createRoot(host);
    act(() => root.render(page));
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("Your account");
    expect(text).toContain("Signed in as oma@example.test");
    for (const title of ["Nordwärts", "Béla's journal", "Cleo reads"]) expect(text).toContain(title);

    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/@ana/studio");
    expect(hrefs).toContain("/@bea/me");
    expect(hrefs).toContain("/@cleo/me");
    expect(hrefs).not.toContain("/@ana/me");
    // Not the operator: no door to /admin.
    expect(hrefs).not.toContain("/admin");

    expect(text).toContain("Your devices");
    expect(text).toContain("iPhone · Safari");
  });

  test("sign out everywhere asks first, naming the device count, and sends nothing until confirmed", async () => {
    serve(HOME);
    root = createRoot(host);
    act(() => root.render(page));
    await flush();

    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Sign out everywhere");
    expect(button).toBeDefined();
    act(() => button!.click());

    expect(host.textContent).toContain("Sign out on all 2 devices and in every journal, this device included?");
    expect(host.textContent).toContain("Agent keys are not sign-ins and keep working.");
    const sent = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    expect(sent.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
});

describe("/me, signed out", () => {
  test("offers the ordinary code sign-in rather than an empty page", async () => {
    serve({ id: null, email: null, journals: [], devices: [], admin: false });
    root = createRoot(host);
    act(() => root.render(page));
    await flush();

    expect(host.textContent).toContain("Your account");
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Your devices");
  });
});

describe("the home page, signed in", () => {
  test("devices moved to /me: the home page links there and carries the account chip", async () => {
    serve(HOME);
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
          />
        </LocaleProvider>,
      ),
    );
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("Continue"); // B2508: the signed-in home, not the pitch
    expect(text).not.toContain("Your devices");
    const toMe = [...host.querySelectorAll('a[href="/me"]')].map((a) => a.textContent);
    // The chip (initial + word) and the sentence link under the list.
    expect(toMe).toContain("OAccount");
    expect(toMe).toContain("Your account: devices and signing out");
  });
});

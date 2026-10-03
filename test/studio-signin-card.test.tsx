import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B-2779 — a signed-out request for any studio address gets one generic
 * sign-in card, the same bytes whether the journal exists (B1829).
 */
const access = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess: async () => ({ email: access.email }) }));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => true }));
vi.mock("@/lib/locales", async (orig) => ({
  ...(await orig<typeof import("@/lib/locales")>()),
  requestLocale: async () => "en",
}));
vi.mock("@/components/landing/PageShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/JournalLocaleProvider", () => ({
  default: ({ username, children }: { username: string; children: React.ReactNode }) => (
    <div data-journal={username}>{children}</div>
  ),
}));
vi.mock("@/components/studio/StudioBar", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/studio/day", () => ({ offlineKeepTrips: () => [] }));

async function html(user: string): Promise<string> {
  const { default: StudioLayout } = await import("@/app/at/[user]/studio/layout");
  const tree = await StudioLayout({
    children: <p>the studio page</p>,
    params: Promise.resolve({ user }),
  } as never);
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {tree}
    </LocaleProvider>,
  );
}

describe("studio layout, signed out", () => {
  beforeEach(() => {
    access.email = null;
  });

  test("a real and a non-existent journal get byte-identical sign-in cards", async () => {
    const real = await html("example");
    const nobody = await html("nobody-here");
    expect(real).toBe(nobody);
    expect(real).toContain('type="email"');
    expect(real).not.toContain("the studio page");
    expect(real).not.toContain("example");
    expect(real).not.toContain("nobody-here");
  });

  test("a signed-in caller reaches the page, whose own gate says 404 to a non-owner", async () => {
    access.email = "someone@example.test";
    const out = await html("example");
    expect(out).toContain("the studio page");
    expect(out).not.toContain('type="email"');
  });
});

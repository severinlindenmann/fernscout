import { beforeEach, describe, expect, test, vi } from "vitest";

/** B2811 — /invite: the form while invite-only, /welcome once signup is open. */
const state = { available: false, inviteOnly: false, signup: true };
vi.mock("@/lib/inviteRequest", () => ({ inviteRequestAvailable: () => state.available }));
vi.mock("@/lib/inviteList", () => ({ inviteOnly: () => state.inviteOnly }));
vi.mock("@/lib/capabilities", () => ({ isEnabled: () => state.signup }));
vi.mock("@/lib/locales", () => ({ requestLocale: async () => "en", translateIn: (_l: string, k: string) => k }));
vi.mock("@/lib/site", () => ({ serverSite: () => ({ name: "Fernscout" }) }));
vi.mock("@/components/InviteRequestForm", () => ({ default: () => null }));
vi.mock("@/components/landing/PageShell", () => ({ default: () => null }));
vi.mock("@/components/landing/kit", () => ({ Band: () => null, TITLE_H1: "" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

beforeEach(() => Object.assign(state, { available: false, inviteOnly: false, signup: true }));

describe("/invite", () => {
  test("open signup redirects to /welcome", async () => {
    const { default: Page } = await import("@/app/invite/page");
    await expect(Page()).rejects.toThrow("REDIRECT:/welcome");
  });
  test("invite-only but unable to take requests is a 404, not a redirect", async () => {
    Object.assign(state, { inviteOnly: true });
    const { default: Page } = await import("@/app/invite/page");
    await expect(Page()).rejects.toThrow("NOT_FOUND");
  });
  test("signup off is a 404", async () => {
    Object.assign(state, { signup: false });
    const { default: Page } = await import("@/app/invite/page");
    await expect(Page()).rejects.toThrow("NOT_FOUND");
  });
  test("invite-only with the form available renders it", async () => {
    Object.assign(state, { inviteOnly: true, available: true });
    const { default: Page } = await import("@/app/invite/page");
    await expect(Page()).resolves.toBeTruthy();
  });
});

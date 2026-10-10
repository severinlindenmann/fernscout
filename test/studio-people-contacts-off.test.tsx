import { describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * B-2746 — with contacts off, /studio/people shows the switched-off banner
 * and no flow, instead of a four-step flow that fails on the last press.
 */
let contacts = false;
vi.mock("@/lib/capabilities", () => ({ isEnabled: (c: string) => (c === "contacts" ? contacts : false) }));
vi.mock("@/lib/studio/pageGate", () => ({ requireStudioOwner: async () => {} }));
vi.mock("@/lib/locales", () => ({ requestLocale: async () => "en", translateIn: (_l: string, k: string) => k }));
vi.mock("@/lib/trips", () => ({ getTrips: () => [], getCurrentTrip: () => null }));
vi.mock("@/lib/contacts", () => ({ listContacts: async () => [], normaliseEmail: (e: string) => e }));
vi.mock("@/lib/users", () => ({ getUser: () => null }));
vi.mock("@/lib/helper/consent", () => ({ hasHelperConsent: () => false }));

async function page(): Promise<ReactElement<{ capabilityOff?: { banner: string }; children?: ReactElement }>> {
  const { default: Page } = await import("@/app/at/[user]/studio/people/page");
  return (await Page({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  } as never)) as never;
}

describe("Who was there with contacts off", () => {
  test("shows the banner and no flow", async () => {
    contacts = false;
    const el = await page();
    expect(el.props.capabilityOff?.banner).toBe("studio.people.off.banner");
    expect(el.props.children).toBeUndefined();
  });

  test("renders the flow when contacts are on", async () => {
    contacts = true;
    const el = await page();
    expect(el.props.capabilityOff).toBeUndefined();
    expect(el.props.children).toBeTruthy();
  });
});

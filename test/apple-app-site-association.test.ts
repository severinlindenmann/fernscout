import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "@/app/.well-known/apple-app-site-association/route";
import { identitySignInUrl, signInUrl } from "@/lib/auth";

/** B2697 — sign-in links open in the iPhone app; nothing else is claimed. */
afterEach(() => vi.unstubAllEnvs());

async function patterns(): Promise<RegExp[]> {
  const body = await (await GET()).json();
  const components: { "/": string }[] = body.applinks.details[0].components;
  // Apple's `*` matches any run of characters.
  return components.map((c) => new RegExp(`^${c["/"].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
}

const claimed = async (url: string) => (await patterns()).some((p) => p.test(new URL(url).pathname));

describe("apple-app-site-association", () => {
  test("is absent without an Apple team", async () => {
    vi.stubEnv("APNS_TEAM_ID", "");
    expect((await GET()).status).toBe(404);
  });

  test("names this instance's app and claims both sign-in link shapes", async () => {
    vi.stubEnv("APNS_TEAM_ID", "TEAM123");
    vi.stubEnv("APNS_TOPIC", "");
    const body = await (await GET()).json();
    expect(body.applinks.details[0].appIDs).toEqual(["TEAM123.ch.fernscout.app"]);
    expect(await claimed(signInUrl("https://x.example", "anna", "tok", "de"))).toBe(true);
    expect(await claimed(identitySignInUrl("https://x.example", "tok"))).toBe(true);
  });

  test("leaves every reader address in the browser", async () => {
    vi.stubEnv("APNS_TEAM_ID", "TEAM123");
    for (const path of ["/", "/@anna", "/@anna/japan-2026", "/@anna/studio", "/j/abc", "/invite/x"]) {
      expect(await claimed(`https://x.example${path}`), path).toBe(false);
    }
  });
});

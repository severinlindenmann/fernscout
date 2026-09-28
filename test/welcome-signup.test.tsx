// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import WelcomeDoor from "@/components/WelcomeDoor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";
import { typeInto } from "./support/type-input";

/**
 * B2170 — making a journal from nothing lives at `/welcome` and ends in the
 * studio. No network: `fetch` is stubbed with the shapes the signup routes
 * answer, as in `test/signup-wizard.test.tsx`.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: () => {} }),
  usePathname: () => "/welcome",
}));

/** B2550 — `intoTheStudio` is a full load (`window.location.assign`), not a
 *  `router.push`: reading pages are now kept in the client router cache for
 *  30s, and a signup that just changed the session cookie must not risk
 *  handing back a page cached from before it.
 *
 *  jsdom's own `location.assign` refuses `vi.spyOn` directly ("cannot
 *  redefine property") — the whole property is swapped instead, same as
 *  `test/trip-map.test.tsx`'s `stubLocationAssign`. */
const assign = vi.fn();
const originalLocation = window.location;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (window as any).location;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).location = { ...originalLocation, assign };

function withLocale(node: React.ReactNode) {
  return <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>{node}</LocaleProvider>;
}

function door(signupEnabled: boolean) {
  return withLocale(
    <WelcomeDoor codeMinutes="20" identityEmail={null} signupEnabled={signupEnabled} />,
  );
}

describe("/welcome", () => {
  test("with signup on, draws the signup steps and a way to sign in instead", () => {
    const html = renderToStaticMarkup(door(true));
    expect(html).toContain('id="signup-email"');
    expect(html).toContain('href="/?start=1"');
    expect(html).not.toContain("switched on here");
  });

  test("with signup off, says so and offers sign-in only — never a dead form", () => {
    const html = renderToStaticMarkup(door(false));
    expect(html).toContain("switched on here");
    expect(html).not.toContain("signup-");
    // IdentitySignIn's own address field is still there.
    expect(html).toContain('type="email"');
  });

  async function finish(redeemOk: boolean) {
    assign.mockClear();
    const responses = [
      { ok: true, json: async () => ({ status: "accepted" }) },
      { ok: true, json: async () => ({ ok: true, token: "signup-token" }) },
      {
        ok: true,
        json: async () => ({ ok: true, token: "agent-token", user: "robin", signIn: "https://t/@robin/s/tok?lang=en" }),
      },
      { ok: redeemOk, json: async () => (redeemOk ? { ok: true } : { error: "link_spent" }) },
    ];
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(responses.shift()!)));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(door(true)));
    const input = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement;
    const submit = () =>
      act(async () => {
        container.querySelector("form")!.requestSubmit();
        await Promise.resolve();
        await Promise.resolve();
      });

    typeInto(input("signup-email"), "new@example.test");
    await submit();
    typeInto(input("signup-code"), "123456");
    await submit();
    typeInto(input("signup-title"), "My Journal");
    typeInto(input("signup-username"), "robin");
    typeInto(input("signup-owner-name"), "Robin Traveller");
    typeInto(input("signup-owner-nickname"), "Robin");
    typeInto(input("signup-currency"), "EUR");
    await submit();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }

  test("finishing lands on the new journal's studio", async () => {
    await finish(true);
    expect(assign).toHaveBeenCalledWith("/@robin/studio");
    expect(document.cookie).toContain(`${JOURNAL_COOKIE}=robin`);
  });

  test("a sign-in that did not take lands on the journal's own sign-in, not a studio 404", async () => {
    await finish(false);
    expect(assign).toHaveBeenCalledWith("/@robin/me");
  });
});

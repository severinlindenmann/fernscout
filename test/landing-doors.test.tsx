import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { useDoors, type InviteCta } from "@/components/landing/Frame";
import { dictionaryFor } from "@/lib/locales";

/** B2811 — the one primary door follows the signup capability, never the helper. */
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function cta(inviteCta: InviteCta, helperEnabled: boolean) {
  let out: ReturnType<typeof useDoors>["cta"] = null;
  function Probe() {
    out = useDoors({ inviteCta, helperEnabled, prints: false, pricing: false }).cta;
    return null;
  }
  renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <Probe />
    </LocaleProvider>,
  );
  return out;
}

describe("the primary signup door", () => {
  test.each([true, false])("open signup: Start your journal at /welcome, helper %s", (helper) => {
    expect(cta("welcome", helper)).toEqual({ href: "/welcome", label: "Start your journal" });
  });
  test("invite-only: Request an invite, helper off too", () => {
    expect(cta("request", false)).toEqual({ href: "/invite", label: "Request an invite" });
  });
  test("signup off: no button", () => {
    expect(cta("none", true)).toBeNull();
  });
});

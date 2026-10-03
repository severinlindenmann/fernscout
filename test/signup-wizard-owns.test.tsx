// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import SignupWizard from "@/components/SignupWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { typeInto } from "./support/type-input";
import { settle, stubWizardFetch } from "./support/wizard-fetch";

/** B-2811 — a code that proves an address already keeping a journal offers
 *  that journal's studio, not a second sign-in form. */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("the wizard's owns step", () => {
  test("offers Open your studio for the redeemer's own journal", async () => {
    stubWizardFetch({
      "POST /api/auth/codes": { __status: 202, status: "accepted" },
      "POST /api/auth/codes/redeem": { __status: 409, error: "too_many_journals", details: { user: "robin" } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onAlreadyOwns = vi.fn();
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <SignupWizard locale="en" codeMinutes="20" onSignedIn={() => {}} onAlreadyOwns={onAlreadyOwns} />
        </LocaleProvider>,
      );
    });
    const input = (id: string) => container!.querySelector(`#${id}`) as HTMLInputElement;
    await act(async () => typeInto(input("signup-email"), "owner@example.test"));
    await act(async () => container!.querySelector("form")!.requestSubmit());
    await settle();
    await act(async () => typeInto(input("signup-code"), "123456"));
    await settle();
    const link = container.querySelector('a[href="/@robin/studio"]');
    expect(link?.textContent).toBe("Open your studio");
    expect(container.textContent).toContain("You already keep @robin");
    expect(onAlreadyOwns).not.toHaveBeenCalled();
  });
});

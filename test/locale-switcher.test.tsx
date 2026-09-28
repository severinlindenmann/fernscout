// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2546: `/de` is rewritten to the same route as `/`, so a soft
 * `router.push` kept the English page and the first pick did nothing. A pick
 * that changes the address is a full load.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

import LocaleSwitcher from "@/components/LocaleSwitcher";

test("picking German on / loads /de, not a soft navigation", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, pathname: "/", search: "", hash: "", assign });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <LocaleSwitcher locales={["en", "de"]} />
      </LocaleProvider>,
    );
  });
  await act(async () => host.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]")!.click());
  await act(async () => host.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")[1].click());
  expect(assign).toHaveBeenCalledWith("/de");
  expect(router.push).not.toHaveBeenCalled();
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

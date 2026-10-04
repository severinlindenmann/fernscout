// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import PageHeader from "@/components/PageHeader";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { STUDIO_GROUPS } from "@/lib/studio/groups";
import type { SiteSummary } from "@/lib/site";

// B-2917 — the owner's header menu carries the Studio link only, not the six studio groups (B2850 put them there).

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site: SiteSummary = {
  username: "alex",
  title: "Fernscout Demo",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  travellerFigures: [],
  signedIn: true,
  name: "Fernscout",
  hasIdentity: true,
  canSignIn: false,
  analyticsEnabled: true,
  helperEnabled: false,
  isOwner: true,
  extractEnabled: false,
  isShowcase: false,
};

function openMenu(isOwner: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <SiteProvider value={{ ...site, isOwner }}>
          <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
            <TripListProvider trips={[]}>
              <PageHeader />
            </TripListProvider>
          </CurrencyProvider>
        </SiteProvider>
      </LocaleProvider>,
    );
  });
  act(() => {
    container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
  });
  const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  act(() => root.unmount());
  container.remove();
  return hrefs;
}

describe("the header menu's studio groups", () => {
  test("the owner's menu keeps the Studio link and lists none of the groups", () => {
    const hrefs = openMenu(true);
    expect(hrefs).toContain("/alex/studio");
    for (const g of STUDIO_GROUPS) expect(hrefs).not.toContain(`/alex/studio#${g}`);
  });

  test("a non-owner's menu has none", () => {
    const hrefs = openMenu(false);
    expect(hrefs.filter((h) => h?.includes("/studio"))).toEqual([]);
  });
});

import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPageContent, { type StoragePanel } from "@/app/at/[user]/account/AccountPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * Storage, on its own page — B821. The credit balance panel this page also
 * once carried was deleted whole in B2592 — plans replaced it, and the
 * "Your plan" panel it was replaced with (`YourPlanPanel`) has no test of
 * its own here yet.
 *
 * Moved whole from `test/access-panel.test.tsx`, where this describe block
 * tested the panel as part of `/me`. The component renders what it is given
 * and asks no question of its own about who may see it —
 * `app/at/[user]/account/page.tsx` is where the owner-only gate and the
 * server-side resolution live, and that is not a React test.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/account",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
} as unknown as SiteSummary;

function render(over: { storage?: StoragePanel } = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <AccountPageContent
              username="alex"
              storage={over.storage}
              orders={{ recent: [], total: 0 }}
            />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the storage card", () => {
  const storage: StoragePanel = {
    used: "4.2 GB",
    limit: "5.0 GB",
    percent: 84,
    rows: [
      { key: "trip:bus-2026", label: "The bus year", human: "3.0 GB", share: 60 },
      { key: "photobooks", label: "Photobooks", human: "1.0 GB", share: 20 },
    ],
    reclaimable: { human: "1.0 GB", files: 6, hasStagedFiles: false },
  };

  test("names every row and its size, not only the colours", () => {
    const html = render({ storage });
    expect(html).toContain("The bus year");
    expect(html).toContain("3.0 GB");
    expect(html).toContain("Photobooks");
    expect(html).toContain("4.2 GB of 5.0 GB used");
  });

  // B2592 — the credit-funded "+5 GB" button this footer once also offered
  // is gone; the cleanup offer is all that is left of it.
  test("offers the cleanup, and says what it takes", () => {
    const html = render({ storage });
    expect(html).toContain("Free up 1.0 GB");
  });

  test("with nothing to reclaim, says nothing rather than explaining itself", () => {
    const html = render({
      storage: { ...storage, reclaimable: { human: "0 KB", files: 0, hasStagedFiles: false } },
    });
    expect(html).not.toContain("Free up");
    expect(html).not.toContain("nothing to clean up");
    expect(html).toContain("4.2 GB of 5.0 GB used");
  });

  test("warns past ninety per cent, and not below it", () => {
    expect(render({ storage })).not.toContain("Nearly full");
    expect(render({ storage: { ...storage, percent: 95 } })).toContain("Nearly full");
  });

  test("is absent when storage is not handed down at all", () => {
    expect(render({})).not.toContain("4.2 GB");
  });
});

describe("neither panel", () => {
  test("says something rather than rendering two empty cards", () => {
    const html = render({});
    expect(html).toContain(dictionaryFor("en")["me.accountCardBody"]);
  });
});

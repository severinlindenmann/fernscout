import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPageContent, {
  type PlanOptionFacts,
  type PlanPanel,
  type StoragePanel,
} from "@/app/at/[user]/account/AccountPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import { PLANS } from "@paid/billing/lib/plans";

// The page (a server component) computes this from `PLANS` — see
// `AccountPageContent.tsx`'s own `chf()` comment for why this file cannot
// import `@paid/billing/lib/plans` directly. Built once here, the same way.
const planOptions: PlanOptionFacts = {
  plus: {
    priceChf: PLANS.plus.priceChf,
    aiDays: PLANS.plus.aiDays,
    storageGb: PLANS.plus.storageGb,
    includedPostcards: PLANS.plus.includedPostcards,
  },
  pass: {
    priceChf: PLANS.tripPass.priceChf,
    days: PLANS.tripPass.days,
    aiDays: PLANS.tripPass.aiDays,
    storageGb: PLANS.tripPass.storageGb,
    includedPostcards: PLANS.tripPass.includedPostcards,
    appUpgradeVoucherRappen: PLANS.tripPass.appUpgradeVoucherRappen,
  },
};

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
const shell = vi.hoisted(() => ({ native: false }));
vi.mock("@/components/nativeShell", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/nativeShell")>();
  return { ...real, useNativeShell: () => shell.native };
});
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

function render(over: { storage?: StoragePanel; plan?: PlanPanel } = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <AccountPageContent
              username="alex"
              storage={over.storage}
              plan={over.plan}
              planOptions={over.plan ? planOptions : undefined}
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
    excess: null,
    rows: [
      { key: "trip:bus-2026", label: "The bus year", human: "3.0 GB", share: 60 },
      { key: "photobooks", label: "Photobooks", human: "1.0 GB", share: 20 },
    ],
    reclaimable: { human: "1.0 GB", files: 6 },
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
      storage: { ...storage, reclaimable: { human: "0 KB", files: 0 } },
    });
    expect(html).not.toContain("Free up");
    expect(html).not.toContain("nothing to clean up");
    expect(html).toContain("4.2 GB of 5.0 GB used");
  });

  // B1392 — the row shows with nothing else reclaimable, and is absent at zero.
  test("offers to delete staged files whenever any are staged", () => {
    const staged = { human: "3 MB", files: [{ id: "a", name: "IMG_1.jpeg", human: "2 MB", day: null }] };
    const html = render({ storage: { ...storage, reclaimable: { human: "0 KB", files: 0 }, staged } });
    expect(html).toContain("1 file waiting, 3 MB");
    expect(html).toContain("Delete them…");
    expect(html).not.toContain("Free up");
    expect(render({ storage })).not.toContain("waiting,");
  });

  test("warns past ninety per cent, and not below it", () => {
    expect(render({ storage })).not.toContain("Nearly full");
    expect(render({ storage: { ...storage, percent: 95 } })).toContain("Nearly full");
  });

  test("is absent when storage is not handed down at all", () => {
    expect(render({})).not.toContain("4.2 GB");
  });

  // B2636 — a journal at 4.0 of 2.0 GB used to still read "Nearly full",
  // although `withStorageQuota`/`storageRefusal` (`lib/storageQuota.ts`)
  // already refuse every write that would push `usedBytes` past
  // `limitBytes`. Three states now: below 90% nothing, 90–99% the same
  // forward-looking "nearly full" warning, 100%+ "Full" with the real
  // excess read from bytes.
  describe("three states, including exactly 100% and past it — B2636", () => {
    test("90–99%: 'nearly full', no claim that anything is refused yet", () => {
      const html = render({ storage: { ...storage, percent: 99, excess: null } });
      expect(html).toContain("Nearly full");
      expect(html).not.toContain("Full.");
    });

    test("exactly 100%: 'Full', not 'nearly full'", () => {
      const html = render({
        storage: { ...storage, used: "5.0 GB", percent: 100, excess: "0 KB" },
      });
      expect(html).toContain("Full.");
      expect(html).not.toContain("Nearly full");
    });

    test("past 100%: 'Full' and the real excess, from bytes", () => {
      const html = render({
        storage: { ...storage, used: "6.1 GB", percent: 122, excess: "1.1 GB" },
      });
      expect(html).toContain("Full.");
      expect(html).toContain("1.1 GB");
      expect(html).not.toContain("Nearly full");
    });

    test("offers one more way to buy Plus once full, only when billing is on", () => {
      const free: PlanPanel = {
        plan: "free",
        periodEnd: null,
        cancelAtPeriodEnd: false,
        renews: false,
        aiDays: { unlimited: false, used: 2, allowed: 10 },
        storageGb: 2,
        hasStripeSubscription: false,
        source: null,
        postcards: null,
        bookDiscountRappen: 0,
      passEndsAt: null,
      vouchers: [],
      };
      const notFull: StoragePanel = { ...storage, percent: 41, excess: null };
      const full: StoragePanel = { ...storage, used: "6.1 GB", percent: 122, excess: "1.1 GB" };
      const count = (html: string) => html.split("Subscribe to Plus").length - 1;

      // The plan panel's own tile already offers Plus to a Free owner — the
      // storage card's own full-state CTA is the *second* one.
      expect(count(render({ storage: notFull, plan: free }))).toBe(1);
      expect(count(render({ storage: full, plan: free }))).toBe(2);
      // No plan at all (billing off) — nothing for the storage card to offer.
      expect(render({ storage: full })).not.toContain("Subscribe to Plus");
    });
  });
});

describe("neither panel", () => {
  test("says something rather than rendering two empty cards", () => {
    const html = render({});
    expect(html).toContain(dictionaryFor("en")["me.accountCardBody"]);
  });

  test("names no balance or credits — B2622", () => {
    const html = render({});
    expect(html.toLowerCase()).not.toContain("balance");
    expect(html.toLowerCase()).not.toContain("credit");
  });
});

/**
 * "Your plan" — B2622's rework to the approved board. First on the page
 * (above the orders card), with meters for AI days, storage and included
 * postcards, the photobook discount, a cancel link only for a live Stripe
 * subscription, and no credit-era wording anywhere.
 */
describe("the plan panel", () => {
  const plusRenewing: PlanPanel = {
    plan: "plus",
    periodEnd: "2027-09-30T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    renews: true,
    aiDays: { unlimited: false, used: 34, allowed: 100 },
    storageGb: 10,
    hasStripeSubscription: true,
    source: "stripe",
    postcards: { used: 2, allowed: 3 },
    bookDiscountRappen: 1000,
  passEndsAt: null,
  vouchers: [],
  };

  test("shows the plan name first, ahead of the orders card", () => {
    const html = render({
      plan: plusRenewing,
      storage: {
        used: "4.1 GB",
        limit: "10.0 GB",
        percent: 41,
        excess: null,
        rows: [],
        reclaimable: { human: "0 KB", files: 0 },
      },
    });
    expect(html.indexOf("Your plan")).toBeLessThan(html.indexOf("Storage"));
    expect(html).toContain("Plus");
    expect(html).toContain("Active");
    expect(html).toContain("Renews 2027-09-30");
  });

  test("meters AI days, storage, postcards and the photobook discount", () => {
    const html = render({
      plan: plusRenewing,
      storage: {
        used: "4.1 GB",
        limit: "10.0 GB",
        percent: 41,
        excess: null,
        rows: [],
        reclaimable: { human: "0 KB", files: 0 },
      },
    });
    expect(html).toContain("34 of 100");
    expect(html).toContain("4.1 GB of 10.0 GB");
    expect(html).toContain("1 of 3 left");
    expect(html).toContain("CHF 10.00 off each");
  });

  test("a live Stripe subscription gets a cancel link and what it means", () => {
    const html = render({ plan: plusRenewing });
    expect(html).toContain("Cancel Plus");
    expect(html).toContain("runs until 2027-09-30");
    expect(html).toContain("Payment method and receipts");
  });

  test("a plan heading toward its end — no subscription, no cancel link — explains what ending means", () => {
    const pass: PlanPanel = {
      plan: "pass",
      periodEnd: "2026-11-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      renews: false,
      aiDays: { unlimited: false, used: 3, allowed: 21 },
      storageGb: 10,
      hasStripeSubscription: false,
      source: "stripe",
      postcards: { used: 0, allowed: 1 },
      bookDiscountRappen: 0,
    passEndsAt: null,
    vouchers: [],
    };
    const html = render({ plan: pass });
    expect(html).not.toContain("Cancel");
    expect(html).toContain("Ending");
    expect(html).toContain("Ends 2026-11-01");
    expect(html).toContain("ends on 2026-11-01");
    expect(html).not.toContain("off each"); // no photobook discount on the pass
  });

  test("Free offers both buy buttons and no renew/end date", () => {
    const free: PlanPanel = {
      plan: "free",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      renews: false,
      aiDays: { unlimited: false, used: 2, allowed: 10 },
      storageGb: 2,
      hasStripeSubscription: false,
      source: null,
      postcards: null,
      bookDiscountRappen: 0,
    passEndsAt: null,
    vouchers: [],
    };
    const html = render({ plan: free });
    expect(html).toContain("Buy a Trip pass");
    expect(html).toContain("Subscribe to Plus");
    expect(html).not.toContain("Renews");
    expect(html).not.toContain("Ends ");
  });

  test("is absent when billing is off", () => {
    expect(render({})).not.toContain("Your plan");
  });

  // B2638 — the two buy buttons used to carry no price at all; Stripe was
  // the only place one appeared, after a click. The tiles' price, cadence
  // and facts come straight from `PLANS`, so this pins them against the one
  // place a price actually lives rather than against a second, copied
  // number.
  describe("the two plan tiles — B2638", () => {
    const free: PlanPanel = {
      plan: "free",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      renews: false,
      aiDays: { unlimited: false, used: 2, allowed: 10 },
      storageGb: 2,
      hasStripeSubscription: false,
      source: null,
      postcards: null,
      bookDiscountRappen: 0,
    passEndsAt: null,
    vouchers: [],
    };

    test("show both prices and facts before any click, read from PLANS", async () => {
      const { PLANS, chf } = await import("@paid/billing/lib/plans");
      const html = render({ plan: free });

      expect(html).toContain(chf(PLANS.plus.priceChf));
      expect(html).toContain(String(PLANS.plus.aiDays));
      expect(html).toContain(`${PLANS.plus.storageGb} GB`);
      expect(html).toContain(String(PLANS.plus.includedPostcards));

      expect(html).toContain(chf(PLANS.tripPass.priceChf));
      expect(html).toContain(String(PLANS.tripPass.days));
      expect(html).toContain(String(PLANS.tripPass.aiDays));
      expect(html).toContain(`${PLANS.tripPass.storageGb} GB`);
    });

    test("Plus is first and carries an audience tag, not 'Recommended'", () => {
      const html = render({ plan: free });
      expect(html.indexOf("For every trip")).toBeLessThan(html.indexOf("Buy a Trip pass"));
      expect(html).not.toContain("Recommended");
    });

    test("a pass owner sees only the Plus tile — no second pass to buy", () => {
      const pass: PlanPanel = { ...free, plan: "pass" };
      const html = render({ plan: pass });
      expect(html).toContain("Subscribe to Plus");
      expect(html).not.toContain("Buy a Trip pass");
    });

    test("a Plus owner sees neither tile", () => {
      const plus: PlanPanel = { ...free, plan: "plus" };
      const html = render({ plan: plus });
      expect(html).not.toContain("Subscribe to Plus");
      expect(html).not.toContain("Buy a Trip pass");
    });

    // B2682 — no priced digital extra outside Apple's own purchase in the app.
    test("the storage add-on is offered on the web and absent inside the iPhone shell", () => {
      const plus: PlanPanel = { ...free, plan: "plus" };
      expect(render({ plan: plus })).toContain("Add 10 GB");
      shell.native = true;
      try {
        expect(render({ plan: plus })).not.toContain("Add 10 GB");
      } finally {
        shell.native = false;
      }
    });
  });
});

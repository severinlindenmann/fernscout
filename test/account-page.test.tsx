import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPageContent, {
  type PaymentPanel,
  type StoragePanel,
} from "@/app/[user]/account/AccountPageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { POSTCARD_CREDITS, TIERS, formatChf } from "@/lib/credits/pricing";
import type { SiteSummary } from "@/lib/site";

/**
 * Credits and storage, on their own page — B821.
 *
 * Moved whole from `test/access-panel.test.tsx`, where these two describe
 * blocks tested the panels as part of `/me`. The component renders what it
 * is given and asks no question of its own about who may see a balance —
 * `app/[user]/account/page.tsx` is where the owner-only gate and the
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

function render(over: { storage?: StoragePanel; payment?: PaymentPanel } = {}) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <AccountPageContent username="alex" storage={over.storage} payment={over.payment} />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the payment section", () => {
  const payment: PaymentPanel = {
    balance: 12,
    emailRecipients: 5,
    whatsappRecipients: 2,
    channels: { mail: true, whatsapp: true },
    postcardCredits: null,
    transactions: [],
    spent: [],
  };

  test("renders the balance and the per-channel estimate", () => {
    const html = render({ payment });
    expect(html).toContain(dictionaryFor("en")["me.paymentTitle"]);
    // The balance is a featured numeral beside its unit label (B392), not a
    // sentence — the digit and the word are separate elements.
    expect(html).toContain("12");
    expect(html).toContain(dictionaryFor("en")["me.paymentUnit"]);
    expect(html).toContain("up to 5");
    expect(html).toContain("up to 2");
  });

  test("says plainly that a zero balance sends nothing", () => {
    const html = render({ payment: { ...payment, balance: 0 } });
    expect(html).toContain(">0<");
    expect(html).toContain(dictionaryFor("en")["me.paymentBalanceEmpty"]);
  });

  test("says nothing about a balance that is not zero", () => {
    const html = render({ payment });
    expect(html).not.toContain(dictionaryFor("en")["me.paymentBalanceEmpty"]);
  });

  test("names what credits went on, and says which of it was a model — B860", () => {
    const html = render({
      payment: {
        ...payment,
        spent: [
          { reason: "helper", credits: 14 },
          { reason: "day_whatsapp", credits: 3 },
        ],
      },
    });
    expect(html).toContain(dictionaryFor("en")["me.spentTitle"]);
    expect(html).toContain(dictionaryFor("en")["me.spentReason.helper"]);
    expect(html).toContain("14");
    expect(html).toContain(dictionaryFor("en")["me.spentAiNote"]);
  });

  test("shows no spend list at all when nothing has been spent", () => {
    expect(render({ payment })).not.toContain(dictionaryFor("en")["me.spentTitle"]);
  });

  /** B369 has not shipped the channel yet; the row is omitted rather than a
   * confident zero that would read as "nobody wants WhatsApp". */
  test("lists recent transactions, with an unpaid one as a link to pay", () => {
    const html = render({
      payment: {
        ...payment,
        transactions: [
          { id: "tx-pending", credits: 100, amount: "CHF 18.00", status: "pending", createdAt: "2026-09-05T10:00:00.000Z" },
          { id: "tx-paid", credits: 50, amount: "CHF 10.00", status: "paid", createdAt: "2026-09-04T09:00:00.000Z" },
        ],
      },
    });
    expect(html).toContain(dictionaryFor("en")["me.txHistoryTitle"]);
    expect(html).toContain("/alex/payment/tx-pending");
    expect(html).toContain(dictionaryFor("en")["me.txPay"]);
    expect(html).toContain(dictionaryFor("en")["me.txPaid"]);
    expect(html).not.toContain("/alex/payment/tx-paid");
  });

  test("shows no transaction history when there are none", () => {
    const html = render({ payment: { ...payment, transactions: [] } });
    expect(html).not.toContain(dictionaryFor("en")["me.txHistoryTitle"]);
  });

  test("omits the WhatsApp row rather than showing a zero, when it is not offered", () => {
    const html = render({ payment: { ...payment, channels: { mail: true, whatsapp: null } } });
    expect(html).toContain("up to 5");
    expect(html).not.toContain("up to 2");
  });

  test("totals what one published day costs right now — the free channel adding nothing", () => {
    const html = render({ payment });
    expect(html).toContain(dictionaryFor("en")["me.paymentDayTotal"]);
    // Five email readers and two on WhatsApp. Email costs nothing since B840,
    // so the day is two credits and the email row says so in words rather
    // than printing a zero.
    expect(html).toContain(">2<");
    expect(html).toContain(dictionaryFor("en")["me.paymentFree"]);
  });

  test("a muted channel still has a row, and costs nothing", () => {
    const html = render({ payment: { ...payment, channels: { mail: true, whatsapp: false } } });
    expect(html).toContain("up to 2");
    // Only the paid channel is muted, and the free one never added anything.
    expect(html).toContain(">0<");
  });

  test("both channels muted means a day costs nothing at all", () => {
    const html = render({ payment: { ...payment, channels: { mail: false, whatsapp: false } } });
    expect(html).toContain(">0<");
  });

  test("names the price of a printed postcard where cards can be sent", () => {
    const html = render({ payment: { ...payment, postcardCredits: POSTCARD_CREDITS } });
    expect(html).toContain(`A printed postcard is ${POSTCARD_CREDITS} credits per card.`);
  });

  test("says nothing about postcards on a journal that does not offer them", () => {
    const html = render({ payment });
    expect(html).not.toContain("A printed postcard");
  });

  test("offers every tier behind the buy button, none of them disabled", () => {
    const html = render({ payment });
    expect(html).toContain(dictionaryFor("en")["me.paymentBuyTitle"]);
    expect(html).not.toContain('disabled=""');
    // Read off TIERS rather than typed out: B840 dropped the middle one, and
    // a list of prices beside the list of prices is how the two disagree.
    for (const tier of TIERS) {
      expect(html).toContain(`${tier.credits} credits`);
      expect(html).toContain(formatChf(tier.priceRappen));
    }
  });

  /** `payment` is `undefined` when credits are switched off — B74: the
   * section is absent, never a greyed-out shell or a dash. */
  test("is absent when payment is not handed down at all", () => {
    const html = render({});
    expect(html).not.toContain(dictionaryFor("en")["me.paymentTitle"]);
  });
});

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
    canBuy: true,
    buyCredits: 50,
  };

  test("names every row and its size, not only the colours", () => {
    const html = render({ storage });
    expect(html).toContain("The bus year");
    expect(html).toContain("3.0 GB");
    expect(html).toContain("Photobooks");
    expect(html).toContain("4.2 GB of 5.0 GB used");
  });

  test("offers the cleanup before the purchase, and says what it takes", () => {
    const html = render({ storage });
    expect(html).toContain("Free up 1.0 GB");
    expect(html).toContain("Add 5 GB for 50 credits");
    expect(html.indexOf("Free up")).toBeLessThan(html.indexOf("Add 5 GB"));
  });

  test("is there with credits off; only the buy button is not", () => {
    const html = render({ storage: { ...storage, canBuy: false } });
    expect(html).toContain("4.2 GB of 5.0 GB used");
    expect(html).toContain("Free up 1.0 GB");
    expect(html).not.toContain("Add 5 GB");
  });

  test("with nothing to reclaim, says nothing rather than explaining itself", () => {
    const html = render({
      storage: { ...storage, reclaimable: { human: "0 KB", files: 0, hasStagedFiles: false } },
    });
    expect(html).not.toContain("Free up");
    expect(html).not.toContain("nothing to clean up");
    expect(html).toContain("4.2 GB of 5.0 GB used");
  });

  test("drops the whole footer when there is neither a cleanup nor a purchase", () => {
    const html = render({
      storage: {
        ...storage,
        canBuy: false,
        reclaimable: { human: "0 KB", files: 0, hasStagedFiles: false },
      },
    });
    expect(html).not.toContain("Free up");
    expect(html).not.toContain("Add 5 GB");
    expect(html).toContain("The bus year");
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

/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: the hosted plans are not included in this build. Nothing is
// priced, so the landing shows no plan line, no plan questions and no prices.
export function printPriceRows(_locale: string): { label: string; price: string }[] {
  return [];
}
export function planPoint(_locale: string): string | null {
  return null;
}
export function planFaq(_locale: string): { q: string; a: string }[] {
  return [];
}

// The announced numbers themselves stay available even without paid/: they
// are public (the business plan, not a secret), and `AiDaysChip`'s upgrade
// offer reads them the same way the real build does — see
// paid/credits/lib/plans.ts for what each field means.
export const PLANS = {
  free: { priceChf: 0, storageGb: 2, aiDays: 10 },
  tripPass: {
    priceChf: 19,
    appPriceChf: 22,
    days: 45,
    aiDays: 21,
    storageGb: 10,
    includedPostcards: 1,
    postcardPriceRappen: 350,
    upgradeWindowDays: 60,
    upgradeCouponChf: 19,
    endingReminderDays: 5,
  },
  plus: {
    priceChf: 49,
    appPriceChf: 59,
    aiDays: 100,
    storageGb: 10,
    extraStorageGb: 10,
    extraStoragePriceChf: 10,
    includedPostcards: 3,
    postcardPriceRappen: 290,
    bookDiscountRappen: 1000,
    renewalReminderDays: 30,
  },
  prints: {
    postcardRappen: 390,
    photobookFromPages: 28,
    photobookFromRappen: 3690,
    photobookPages: 46,
    photobookPagesRappen: 4790,
  },
} as const;

export function chf(amount: number): string {
  return `CHF ${amount}`;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: buying credits is not included in this build. The constants
// below are the published contract values (they appear as literals in
// /api/v2/openapi.json and in status payloads), mirrored from
// paid/credits/lib/credits/pricing.ts; the price functions answer zero.
export const MIN_CREDITS = 10;
export const MAX_CREDITS = 500;
export const CREDIT_STEP = 10;
export const BUYER_METHODS = ["twint", "card"] as const;
export const POSTCARD_CREDITS = 20;
export const EXTRA_STORAGE_CREDITS = 50;
export const EXTRA_STORAGE_BYTES = 5 * 1024 ** 3;

export function discountFor(_credits: number): number {
  return 0;
}
export function priceRappen(_credits: number): number {
  return 0;
}
export function discountLabel(_credits: number): string {
  return "";
}
export function creditsInRappen(_credits: number): number {
  return 0;
}

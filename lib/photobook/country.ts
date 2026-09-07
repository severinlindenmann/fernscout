import { COUNTRY_CODES } from "../countryCodes";

/**
 * A contact's country as Gelato needs it: ISO 3166-1 alpha-2.
 *
 * A contact's country is whatever the person typed on the form that took
 * their address — "Switzerland", "switzerland" and "CH" are all in the table
 * — and Gelato refuses anything that is not the two-letter code. Guessing
 * "CH" for an unrecognised one would quote Swiss postage for a book going
 * somewhere else, so an unknown country answers `null` rather than a guess.
 *
 * Its own module — not `lib/photobook/print.ts`, which imports it — because
 * `test/photobook-print.test.ts` asserts that nothing under `app/api` even
 * *names* `photobook/print`, and the proposal route (`app/api/v1/[user]/
 * photobooks/[id]/print/route.ts`) needs this same lookup to quote a book
 * before anybody has agreed to spend anything.
 */
export function isoCountry(name: string | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return COUNTRY_CODES[raw.toLowerCase()] ?? null;
}

/**
 * The address lookup capability's own wire shape — split out of
 * `lib/addressLookup.ts` so `AddressLookupField.tsx` (a client component) can
 * import the type without pulling in `server-only` and the provider fetch
 * that goes with it. Everything that actually talks to a provider lives in
 * that file; this one is just what the two sides agree on.
 */

/** Below this many characters a query is a keystroke, not a search — and
 * sending it anyway is a request for nothing plus a line in someone else's
 * access log. Read by both the client's own debounce and the route's own
 * refusal, so the two numbers cannot drift apart. */
export const MIN_QUERY_LEN = 3;

/** Above this, a "query" is either pasted garbage or an attempt to see what
 * the proxy does with it. No real street address needs it. */
export const MAX_QUERY_LEN = 200;

/** What a suggestion fills in. `country` is the ISO2 `CountryField` (B398)
 * already knows how to hold — Photon's `countrycode`, uppercased. */
export type AddressSuggestion = {
  line1: string;
  postcode: string;
  city: string;
  country: string;
};

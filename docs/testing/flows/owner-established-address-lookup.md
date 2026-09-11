# Flow: owner-established-address-lookup

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** journal UI (the form the lookup serves) — the browser never
talks to the provider directly, per `app/api/address-lookup/route.ts`'s own
comment: this route is the only thing that does.
**Capabilities exercised:** `addressLookup`
**Device/locale:** run at the requested viewport — a type-ahead is exactly
the kind of control that behaves differently on a touch keyboard.
**Check type:** technical (the provider is never reached from the browser, a
short query is refused, a provider failure reads honestly) and graphical (the
type-ahead itself).

## Setup

1. Local dev server running with `features.addressLookup` on,
   `provider: "photon"` (the shipped default — no key, no signup, matching
   AGENTS.md's rule).
2. `test-owner-established` journal with a postal-address form reachable —
   the contact/postcard-recipient address entry this route serves.

## Steps

1. As the owner, open the address form and type a few characters of a real
   street. Confirm nothing under 3 characters (`MIN_QUERY_LEN`) issues a
   request, and confirm the request that does go out is
   `GET /api/address-lookup?user=test-owner-established&q=…&locale=…` from
   this app's own origin — never a request to `photon.komoot.io` visible in
   the browser's own network panel.
2. Confirm results render as suggestions and picking one fills the form.
3. Query longer than `MAX_QUERY_LEN`. Confirm `400 query_too_long` and
   nothing is looked up.
4. Query more than 30 times in a minute from the same IP. Confirm
   `429 too_many_requests` with a `Retry-After` header.
5. With `ADDRESS_LOOKUP_API_KEY` (or the provider itself) misconfigured or
   unreachable, confirm the route answers `502 lookup_unavailable` — not an
   empty result list, which the route's own comment says used to read as "no
   match" and hid an outage for a week (B639).

## Done when

- No provider request is ever visible from the browser — only same-origin
  calls to `/api/address-lookup` (technical check, the route's own stated
  guarantee).
- The short-query, long-query and rate-limit refusals each answer with their
  documented status and error code, and none of them reach the provider
  (technical check).
- A provider failure reads as `lookup_unavailable`, never as zero results
  (technical check, B639).
- The type-ahead renders and picks correctly at the requested viewport
  (graphical check).

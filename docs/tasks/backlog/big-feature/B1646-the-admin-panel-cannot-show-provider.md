---
id: B1646
title: The admin panel cannot show provider balances, bills, or order attention
type: FEATURE
priority: medium
complexity: high
area: admin, provider billing, orders
found: "2026-09-13T08:22:52Z"
---

# B1646 — The admin panel cannot show provider balances, bills, or order attention

## Why

The operator currently has to open Stannp, Gelato, Deepgram, Anthropic and
Twilio separately to know whether a service needs a top-up or attention. Meta
invoices are another separate place to check, and order status has to be
reviewed journal by journal. The admin panel should be the operator's one
operational view instead of requiring provider-by-provider visits.

## Work

Add an admin-only provider and orders dashboard that fetches live data on page
load and caches the result in the browser for four hours unless the operator
presses Refresh. It covers:

- balance or remaining budget for Stannp, Gelato, Deepgram, Anthropic and
  Twilio;
- open Meta bills and their current state;
- photobook and postcard order status across every journal;
- attention flags for low balances, failed or blocked provider calls, unpaid
  bills and orders needing operator action;
- a direct provider link wherever an API cannot expose the needed balance or
  billing detail.

Provider credentials stay server-side and are never exposed to the browser.
The dashboard is restricted to the existing admin access; journal owners and
guests cannot see it. A provider with no supported API is shown as unavailable
with its configured external link, not as a guessed balance.

## Acceptance

- An admin can open one panel and see live balance/budget cards for all five
  providers, with a clear unavailable/link state where a provider does not
  expose an API.
- The panel shows open Meta bills and their state.
- Photobook and postcard orders are listed across all journals with current
  status and attention flags.
- Low balances, failed provider calls, unpaid bills and actionable order states
  are visibly flagged.
- A reload within four hours uses the browser cache; Refresh bypasses it and
  fetches live data.
- Non-admin requests are refused, and provider secrets never appear in the
  response or browser storage.
- Tests cover provider success, unavailable APIs, stale-cache refresh,
  attention flags and admin authorization.
- `npm run verify` passes.

---
id: B435
title: No print provider can actually post a card — Stannp is built but never called
type: FEATURE
priority: high
complexity: medium
area: postcards
found: "2026-09-05T10:12:20Z"
started: "2026-09-07T15:51:05Z"
merged: "2026-09-07T16:03:51Z"
completed: "2026-09-09T16:45:39Z"
---

# B435 — No print provider can actually post a card — Stannp is built but never called

## Why

`lib/postcard/providers.ts` offers three names and only `dry-run` works.
`buildStannpRequest` is a request *description* written from published docs and
called by nothing; `swisspost` is documented as unusable.

This ticket originally chased **print.one**, on the owner's pricing preference,
and its whole first step was a timeboxed probe to find out whether print.one
would even accept an uploaded PDF — because its documentation is a JavaScript
app that returns an empty page to a fetch, and the only available description
was a template-plus-merge-variables model that B434's design cannot survive.

That probe is moot: there is now a **Stannp account with keys**. Stannp takes an
uploaded PDF, which is what B434 assumed, so the preview keeps showing the exact
bytes that get printed and no rendering decision reopens.

Three things in the builder are wrong against Stannp's current reference, and
each is the kind of thing whose first symptom is a ruined card:

| Builder says | Stannp actually |
| --- | --- |
| `https://eu.stannp.com/api/v1/postcards/create` | `https://api-eu1.stannp.com/v1/postcards/create` |
| `recipient[town]` | `recipient[city]` |
| — | `padding=0`, or they lay a white border over our full-bleed art |

## Work

1. Correct `buildStannpRequest` — endpoint, `recipient[city]`, `padding: 0` —
   and change `fields` from prose descriptions to the actual text fields, so
   the builder and the client cannot drift into two lists that disagree.
2. `lib/postcard/stannp.ts`: one function that posts. Native `fetch`,
   `FormData` and `Blob`; HTTP basic auth (`key:`); front and back as PDF
   parts. No dependency. Refuses outright with no `STANNP_API_KEY` rather than
   half-running.
3. `handToProvider` in `lib/postcard/send.ts` gains a `stannp` branch,
   recording `stannp:<their id>` as the ledger ref.
4. `app/api/v1/[user]/postcards/route.ts:186` hardcodes `const provider =
   "dry-run"`, so `features.postcards.provider` is presently ignored. Read the
   config.
5. **Test mode is the default and it is free.** Stannp's `test=true` produces a
   sample PDF and never dispatches the item. A new `features.postcards.live`
   key, absent or `false`, forces `test=true` on every call — so a real key,
   a real order and a real press of Send still post nothing. Flipping one
   boolean is the only path to paper.
6. `/api/health` says which mode it is in, beside the `dry-run` note that is
   already there for exactly this reason (B492).

**Not doing:** posting a real card, and not touching the credits path — an
order still spends the journal's own credits in test mode, because branching
the money code to make test sends free is the wrong place to be clever.
Posting real paper is B437.

## Acceptance

- With `provider: "stannp"` and `STANNP_API_KEY` set, ordering a card and
  pressing Send reaches Stannp and comes back with an id and a sample PDF URL.
- With `live` absent or `false`, the request carries `test=true` — asserted by
  a unit test against a stubbed `fetch`, never the network.
- With `STANNP_API_KEY` unset the provider refuses; `dry-run` is unaffected and
  a fresh clone with no account still works.
- `/api/health` distinguishes stannp-in-test from stannp-live from dry-run.
- `docs/providers/postcards.md` carries the corrected field table.

## Blocks

B437.

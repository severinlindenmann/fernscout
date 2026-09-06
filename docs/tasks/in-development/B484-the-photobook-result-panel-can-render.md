---
id: B484
title: The photobook result panel can render with no download links
type: ISSUE
priority: low
complexity: low
area: photobook
found: "2026-09-05T15:17:21Z"
started: "2026-09-06T14:20:14Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:14Z"
---

# B484 — The photobook result panel can render with no download links

## Why

Two narrow gaps in B476's order-outcome page, both found by review and neither
worth blocking that merge.

**The result panel can have nothing in it.** After a successful order the page
reads the order row and builds download links from `payload.files`. That field is
written by `markPrinted`, whose terminal transition is guarded on
`status = 'submitted'` and which returns `false` when the row has already moved
on. In that case the payload keeps no `files`, and the owner — who has paid — is
shown a success panel with no links. The mail still carries them, so nothing is
lost, but the page is the first thing they see.

**An unknown outcome renders as silence.** `PhotobookOutcome.state` is typed
`string` rather than a union of the states the route actually redirects with, so
a state with no `OUTCOME_MESSAGE` entry renders nothing at all rather than
failing loudly or falling back. That is how a future state gets added and shows
the owner an empty page.

## Work

Make `state` a union of the route's own outcomes so the compiler requires a
message for each, and give the success panel something honest to say when the
file list is empty — the mail has the links, and saying so beats a blank box.

**Not doing:** changing `markPrinted`'s guard. It is correct, and B476's review
confirmed it prevents a refunded order reading as printed.

## Acceptance

- Adding a redirect state without a message fails the typecheck.
- A success panel with no stored file list tells the owner where the links are
  instead of showing an empty panel.

## Done

`lib/photobook/orders.ts` now exports `PHOTOBOOK_OUTCOME_STATES` (`"done" |
"duplicate" | "no_credits" | "no_photos" | "failed"`) and
`PhotobookOutcomeState`, and `PhotobookOutcome.state` is typed as that union
instead of `string`. `outcomeFrom` validates the query's `state` against it
and returns `null` for anything else, so a stray or stale `?state=` never
reaches the page as a value with nowhere to look up a message.

`OUTCOME_MESSAGE` in `PhotobookPageContent.tsx` is now `Record<Exclude<
PhotobookOutcomeState, "done">, TranslationKey>` — an exact object type, not
`Record<string, …>` — so a state added to the union without an entry here
fails `tsc` ("property … is missing"), and a stale entry for a state the
union no longer has fails it too ("object literal may only specify known
properties"). That second case was real: `refund_failed` was in the map and
in the locale files from before B509 reordered the route to build before
charging, so a failed build is never charged and there was nothing left to
refund. It is gone from the union and from `OUTCOME_MESSAGE`; the locale
strings (`photobook.refundFailed` in all three shipped locales) are left in
place, unused — `test/locales.test.ts` only checks that every *shipped* key
exists in every locale, not that every key is reachable, and deleting a
locale key across `en`/`de`/`hu` plus running `npm run i18n:keys` was more
than this ticket needed.

The success panel: `outcome.orderId && outcome.files.length > 0` is now the
condition on the `<ul>` of download links, with an `else` that renders
`photobook.done.filesInMail` ("The download links are in the mail that is on
its way, rather than here.") — a new key, added to all three locale files and
folded into `TranslationKey` via `npm run i18n:keys`. Nothing about
`markPrinted`'s `status = 'submitted'` guard changed, per the ticket's own
"not doing".

Evidence:
- `test/photobook-outcome-panel.test.tsx` (new) — one test parses
  `PhotobookPageContent.tsx`'s `OUTCOME_MESSAGE` block and asserts its keys
  are exactly `PHOTOBOOK_OUTCOME_STATES` minus `"done"` (the same
  belt-and-suspenders pattern `test/locales.test.ts` already runs for
  `TranslationKey`, per B529) — this is what makes the exhaustiveness
  guarantee checkable even under `--quick`, which skips `tsc`. Two more
  render the component (`renderToStaticMarkup`, the pattern
  `test/page-header-title.test.tsx` uses) with `outcome.files` non-empty and
  empty, and assert the download list versus the `filesInMail` fallback.
- `test/photobook-orders.test.ts` — "a state order/route.ts would never send
  back is not an outcome at all": `outcomeFrom` returns `null` for
  `"refund_failed"` and for a made-up state.
- `npm run verify` — full run, green (see B482's entry above; both tickets
  were built and verified together in one worktree).

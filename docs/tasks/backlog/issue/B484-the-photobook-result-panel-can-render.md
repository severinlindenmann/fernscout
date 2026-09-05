---
id: B484
title: The photobook result panel can render with no download links
type: ISSUE
priority: low
complexity: low
area: photobook
found: "2026-09-05T15:17:21Z"
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

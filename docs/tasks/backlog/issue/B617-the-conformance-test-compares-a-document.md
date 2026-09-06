---
id: B617
title: The conformance test compares a document about files against a validator for requests
type: ISSUE
priority: medium
complexity: low
area: content model, validation, testing
found: "2026-09-06T15:36:53Z"
---

# B617 — The conformance test compares a document about files against a validator for requests

## Why

Noticed while reading B608's results, before filing its findings.

`content-model.json` describes **files on disk**. `lib/validate/entry.ts`
validates **an API request body**. The conformance test runs both over the same
fixtures and asserts they agree — and for most rules that is exactly right,
because most keys mean the same thing in both places.

Two of the seven disagreements it reported are not drift. They are the two
representations differing *by design*:

- **`costs`** — the document says `type: "array"`, and for a file that is
  correct. A file never carries `costs: false`; it says `without: [costs]`,
  and `unrecorded: [costs]` for `"unknown"`. `publish.mjs` performs that
  translation on the way out. The API validator accepting `false` and
  `"unknown"` is not a rule the file shape is missing.
- **`test`** — same shape of question, and worth checking rather than
  assuming: does a file carry it at all?

Left alone, the test will keep producing findings of this kind whenever the
file and the wire differ on purpose, and each one costs somebody the work of
deciding it is not a bug. A conformance test whose findings need triage stops
being read — which is how the checks this plan is about got lost in the first
place.

W41 named this boundary and the test does not yet model it: the mapping
`without: [x]` ⇒ `x: false` and `unrecorded: [x]` ⇒ `x: "unknown"` is part of
the contract, and is the one thing `publish` takes from the document.

## Work

- Teach the test the translation, so a file-shape rule is compared against the
  API validator *after* the same mapping `publish.mjs` applies. Then `costs`
  should agree, and if it does not, that is real drift.
- Decide what `test:` is in a file — a key a file may carry, or wire-only — and
  say which in `model.mjs`/`document.ts`. Then either the rule or the silence
  is deliberate.
- Where a difference is genuinely by design and cannot be mapped away, the
  document should say so — a `never-in-file` / `never-over-api` rule already
  exists for exactly that, and is the honest way to record it.
- Re-triage B608's seven findings once this lands. B615 and B616 are believed
  to be real; findings 1 and 2 are the ones this ticket is about.

Not doing: changing what the server accepts, or what a file may carry.

## Acceptance

- The test applies the `without:`/`unrecorded:` mapping before comparing, and
  `costs` agrees.
- Every remaining disagreement in `test/content-model.test.ts` is one somebody
  has decided is real, each naming its ticket.
- A newly introduced genuine drift still fails the test — proven by
  introducing one.

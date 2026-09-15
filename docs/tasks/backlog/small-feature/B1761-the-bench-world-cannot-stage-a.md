---
id: B1761
title: The bench world cannot stage a photograph, a voice note, a pin, an invite or a balance
type: FEATURE
priority: medium
complexity: medium
area: testing, whatsapp
found: "2026-09-15T05:34:23Z"
---

# B1761 — The bench world cannot stage most of what this product holds

## Why

`scripts/helper-bench.mts` can stage trips, contacts and days. It cannot stage
a photograph, a voice note, a location pin, a document, an invite, a credit
balance or an approved reader — so none of those can be tested, and both
authors of the current corpus said so in the `wanted` list at the foot of
`docs/benchmarks/helper-behaviour/corpus.json` rather than writing scenarios
that could not run.

That is most of the surface. Photographs are the commonest thing anybody sends
this channel, and there is not one scenario about them.

It has already cost a false finding: before days could be staged,
`cost-on-a-day` read 0% because a cost had nowhere to land, and the honest
answer — "there is no day yet" — was being scored as a failure.

## Work

Take them in the order the channel actually receives them:

- **Photographs** — `storeInboxFile` plus a real JPEG; `test/support/pictures`
  already paints one.
- **Voice notes** — the transcription path has a dry-run backend.
- **Location pins and documents** — both already land in the inbox.
- **Invites, approved readers, a credit balance** — rows, so a fixture is a
  few inserts.

Each one unlocks scenarios already written down in `wanted`.

## Acceptance

- Every line of `wanted` is either a runnable scenario or has a sentence
  saying why it stays unrunnable.
- A photograph scenario exists, because that is the commonest message on this
  channel and today it has no coverage at all.

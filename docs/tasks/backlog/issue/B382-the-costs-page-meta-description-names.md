---
id: B382
title: The costs page meta description names the journal by its URL slug instead of its title
type: ISSUE
priority: low
complexity: low
area: i18n
found: "2026-09-04T21:53:19Z"
---

# B382 — The costs page meta description names the journal by its URL slug instead of its title

## Why

The costs page's `<meta name="description">` reads:

> What Cherry blossom, north to south actually cost, itemised in
> **xydhd-lifecycle**'s currency.

Observed on fernscout.ch at e85248d, three times in one page. `xydhd-lifecycle`
is the journal's URL slug; its name is "The Lifecycle Journal". The slug is a
directory name and an address, not something to show a reader -- and this is
the description search engines and chat previews quote.

Two honest repairs, and either is better than the slug: name the journal by its
`title`, or name the currency itself ("itemised in CHF"), which is what the
sentence is actually about.

Found alongside B214, which is the tense of the same sentence.

## Acceptance

No rendered page shows a journal's username where its title belongs.

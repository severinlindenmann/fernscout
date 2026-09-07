---
id: B775
title: A guest trip's day is announced as public, in the feed and readable by anyone with the link
type: ISSUE
priority: high
complexity: low
area: entries, visibility
found: "2026-09-07T14:23:36Z"
started: "2026-09-07T14:25:40Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T14:25:40Z"
---

# B775 — A guest trip's day is announced as public, in the feed and readable by anyone with the link

## Why

`publishNotice()` in `lib/api/entries.ts:1386-1404` branches on `test: true` and
on nothing else. It never looks at the trip's visibility, so publishing a day
on a `guest` or `private` trip answers with the sentence written for a public
one:

> "It is in the journal, the feed and the search index, and anyone with the
> link can read it."

Verified live on 2026-09-07 against a `guest` trip: the journal's
`search-index.json` reported `documentCount: 0`, `feed.xml` carried no items,
and fetching the day anonymously returned the sign-in gate rather than the
content. All three claims in that sentence were false.

This is worse than a cosmetic wording bug for two reasons. `/agent.md` tells an
agent to relay this line to the person, so the falsehood is designed to be
repeated to somebody who cannot check it. And it is false in the frightening
direction: an owner who chose `guest` precisely so that strangers could not
read their trip is told, by the software, that anyone with the link now can.
The likely reaction is to unpublish something that was never exposed.

Found by driving the live instance as a sceptical technical user.

## Work

`publishNotice()` takes the trip's visibility and says what is actually true
for each: public — the feed, the search index, anyone with the link; `guest` —
everyone let into this journal; `private` — the people on this trip. Say who,
not just how far.

Check the same sentence has not been copied into `/agent.md` or
`lib/api/agentCopy.ts` where a second version could disagree.

## Acceptance

Publishing a day on a `guest` trip says so, and says nothing about the feed,
the search index or anybody with a link. A test covers all three visibilities.

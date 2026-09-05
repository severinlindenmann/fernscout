---
id: B158
title: The publish confirmation promises feed and search for a day that is excluded from both
type: ISSUE
priority: low
complexity: low
area: mcp, test-content, publishing
found: "2026-09-03"
started: "2026-09-04T06:22:43Z"
merged: "2026-09-04T06:50:21Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T07:38:39Z"
---

# B158 — Two places that describe a test day as if it were ordinary

Found while verifying B28 on the live instance. Both are the same family as
**B116** (which was built and merged the same day, and is in `testing/` — these
were not in its scope).

## Why

**The publish confirmation overstates what publishing will do.** The
`confirmation_required` message reads:

> This publishes "B28 publish probe" (2026-08-22) to
> https://fernscout.ch/xydhd-qa1. It goes into the journal, the feed and the
> search index, and anyone with the link can read it.

For a `test: true` day none of the feed or search half is true. Observed
directly: after publishing `b28-publish-probe`, `/xydhd-qa1/feed.xml`,
`/sitemap.xml` and the site search index all correctly excluded it.

That sentence is the last thing a person reads before saying yes. It is the
one moment the software has their full attention, and it is describing a
different day than the one in front of them. The fix is to say what will
happen to *this* day — which for a test day is a shorter and more reassuring
sentence.

**MCP `search_entries` returns published `test: true` days**, while the public
search index and feed exclude them. This is the same structured-versus-public
split B116 fixed for `list_trips`. It may well be *right* — an agent searching
the journal it is working in probably does want to find its own test content —
but it is undecided rather than decided, and it is the last surface where the
two disagree.

Neither costs anything today. Both are the kind of small inconsistency that
makes somebody distrust the flag later, which is the thing B47 and B116 have
each already had to repair.

## Work

- Make the confirmation message reflect the day being published: for a
  `test: true` day, say it goes onto the site and is kept out of the feed, the
  search index and the sitemap.
- Decide `search_entries` deliberately and record the decision in the tool's
  description, whichever way it goes. If test days stay findable there, the
  result should say which ones they are — B116's rule, applied to the last
  surface.

## Acceptance

- Publishing a test-flagged day describes the exclusions rather than promising
  the opposite.
- Publishing an ordinary day is unchanged.
- `search_entries`' treatment of test content is stated in its description and
  matches what it does.

## Built (2026-09-04)

Both halves, and the second one is now decided rather than left open.

**The confirmation.** `publishNotice()` in `lib/api/entries.ts` is the sentence,
written once and read by both doors. For a `test: true` day — the trip's flag
counts, not only the entry's — it says the page will carry a banner and that the
day is kept out of the feed, the search index and the sitemap; for an ordinary
day it says exactly what it said before. The two doors had drifted already (the
REST message named the URL and the MCP one did not), which is the argument for
one function rather than two strings: `test/mcp.test.ts` now asserts the REST
refusal message is contained in the MCP one, so a future edit to one is an edit
to both.

**`search_entries`.** Decided: test days stay findable, and every result that is
one says so — in the line as well as in the data, because a caller reading only
`text` is the failure B116 fixed. The reasoning is in the tool description and
in `searchDocs`: this is the agent's own journal, so the one kind of content it
is allowed to invent should not also be the one kind it cannot look up, and the
public index is a different corpus for a different audience. The flag is carried
beside the documents rather than inside `SearchDoc`, whose shape is shared with
the static browser index through `SEARCH_OPTIONS.storeFields`.

Nothing here publishes anything. The confirmation is still refused once, still
bound to that one day, and still owner-only.

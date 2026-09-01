---
id: B61
title: The markdown twin is the one route that does not know a journal was deleted
type: ISSUE
priority: low
complexity: low
area: markdownTwin, deletions
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B61 — The markdown twin is the one route that does not know a journal was deleted

## Why

Found by deleting a journal (`alpenweg`) through the API and then walking every
route it used to serve. Nine of ten answer `410 Gone`; the twins answer `404`:

```
/alpenweg                                        410
/alpenweg/documentation.txt                      410
/alpenweg/feed.xml                               410
/alpenweg/search-index.json                      410
/alpenweg/export.zip                             410
/alpenweg/trips                                  410
/alpenweg/trips/testreise-2026/day/erster-tag    410
/alpenweg/trips/testreise-2026/day/erster-tag.md 404   ←
/alpenweg/day/erster-tag.md                      404   ←
/alpenweg/me                                     410
```

`404` and `410` are not the same instruction. `404` says "no day by that slug"
— fix the URL and try again. `410` says "this was here, the person removed it,
and it is not coming back" — stop, and tell whoever asked. The deletion flow is
careful about exactly this distinction: the tombstone page says the address
"wird niemand anderem gegeben", and the point of that promise is that an old
link keeps telling the truth.

The twin is the surface where the wrong answer costs most, for the same reason
it mattered in B47: **it is the route built so that agents read it instead of
the page.** An agent polling a twin — or retrying one from a stale search
index — is told to fix its slug, so it retries, or reports "that day does not
exist" to somebody whose journal was deleted last week.

The body makes it worse by being helpful:

> Days are listed at `/alpenweg/documentation.txt`, and identified there as
> `<trip-id>/<slug>`.

That URL is itself `410`. The one piece of advice in the message is a dead end.

`lib/api/markdownTwin.ts` resolves through `getTrip`/`readable`, both of which
answer "nothing here" for a deleted user, and then falls to its own
`notFound()`. It never consults the tombstone — `journalTombstone` in
`lib/tombstones.ts`, which is what every other route above uses.

## Work

- Check the tombstone in `markdownTwin` before the trip lookup, and answer
  `410` with a plain-text body saying the journal was deleted and when — the
  same fact the HTML page states, in the form this route speaks.
- Keep it plain text. This route answers `text/plain` on a miss precisely so no
  agent pulls forty kilobytes of HTML into a context window, and that reasoning
  does not change because the status did.
- The existing `404` for a genuinely unknown slug in a live journal stays
  exactly as it is, wording included. That is a different answer to a different
  question and B31 is the standing lesson about collapsing two of those.
- While there: the `404` body points at `/<user>/documentation.txt`, which is
  the right advice for a live journal and a dead link for a deleted one. The
  410 branch must not repeat it.

## What was found while building it

The Why was right about the symptom and wrong about where the other nine 410s
come from. They are not per-route: `proxy.ts` answers them, and its matcher
excludes `.md` by extension while naming `documentation.txt`, `feed.xml`,
`search-index.json` and `story.json` explicitly. The twins fell through both
halves of that.

**So the obvious fix — add the twins to the matcher — is the wrong one.**
`gonePage` in `proxy.ts` answers in HTML. This route answers `text/plain` on
purpose, so an agent polling it never pulls markup into a context window, and
that reasoning does not stop applying because the status changed. Handled in
the route instead, which is what the Work section had said for a different
reason.

Two things beyond the ticket:

- **A deleted *trip* in a living journal** had the same gap and is covered by
  the same check. `tripTombstone` already existed for it.
- **The 410 body says nothing about what to try next**, deliberately. The 404's
  advice is to read `/<user>/documentation.txt`, which for a deleted journal is
  itself a 410 — a message whose only help is a dead end is how a retry loop
  starts. It gives the deletion date instead, so an agent working from a stale
  search index can see that the index is what is out of date.

Four of the five new assertions fail against the previous code, confirmed by
stashing the fix.

## Acceptance

- `/{user}/trips/{trip}/day/{slug}.md` and `/{user}/day/{slug}.md` both answer
  `410` for a deleted journal, in `text/plain`, saying it was deleted.
- Neither points the reader at a URL that also answers `410`.
- A miss inside a live journal still answers `404` with today's wording, and a
  test asserts that string is unchanged.

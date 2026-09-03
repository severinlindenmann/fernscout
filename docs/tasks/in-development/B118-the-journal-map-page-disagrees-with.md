---
id: B118
title: The journal map page disagrees with itself about tense between its heading and its tab title
type: ISSUE
priority: low
complexity: low
area: i18n, trips, ui
found: "2026-09-03"
started: "2026-09-03"
---

# B118 — The journal map page disagrees with itself about tense

## Why

Found while verifying B54 on the live instance. B54 fixed the *trip* map page
and explicitly left the journal-level one alone, under "Not changed". This
task is not a disagreement with that call — it is a report that the case B54
treated as transient is observable on a live journal today, in a way that
contradicts itself on a single page:

```
$ curl -s https://fernscout.ch/xydhd-qa1/map
<h1>Where we're going</h1>
<title>Where we've been · QA one</title>
```

One page, two tenses, about the same trip. The `<h1>` comes from the client
component's `entries.length > 0 ? "map.title" : "map.titlePlanned"` conditional
that B54 introduced; the `<title>` comes from
`app/[user]/(trip)/map/page.tsx:27-30`, which calls `translateIn(…,
"map.title")` unconditionally and never learned the distinction.

What makes it worth a ticket rather than a note: the reason B54 judged this
low-stakes was that a journal's *current* trip is normally underway, so past
tense is right. But `getCurrentTrip` falls back to the **most recent past
trip** when nothing is current, and a past trip with zero entries then renders
the planned heading — so the mismatch is not a brief window while a trip is
about to start. It is the steady state for any journal whose newest trip has no
days written to it, which includes every journal between trips.

The cost is small and entirely presentational: a browser tab, a bookmark, a
link preview and a shared screenshot carry the `<title>`, and it says the
opposite of the heading beneath it. No data is wrong and nothing is hidden.

## Work

Give the metadata the same conditional the heading has. The page already
resolves the trip and its entries to decide what to render; the title needs
the same two-branch choice between `map.title` and `map.titlePlanned`, in
`app/[user]/(trip)/map/page.tsx`.

Check the other per-trip routes for the same split while in there — a heading
rendered client-side from a conditional and a `generateMetadata` that picks a
string unconditionally is a shape that repeats, and the gallery and costs
pages are the obvious neighbours.

Not doing: the costs page's tense, which B54 defers to **B19** and which is a
larger copy question than one string.

## Acceptance

- `/<user>/map` for a journal whose current trip has no entries returns a
  `<title>` and an `<h1>` in the same tense.
- A trip with entries still reads in the past tense in both.
- The German and Hungarian dictionaries render the same pairing — this is the
  kind of fix that gets made in `en.json` alone.

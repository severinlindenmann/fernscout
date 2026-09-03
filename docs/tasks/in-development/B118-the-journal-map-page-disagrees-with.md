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

### What the work turned up

**The Why held up.** `getCurrentTrip` (`lib/trips.ts:528–531`) is
`find(status === "current") ?? find(status === "past")`, so a journal between
trips renders its most recent past trip on `/<user>/map`, and a past trip with
no entries is a permanent state rather than a window. Nothing in the Why needed
correcting.

**No new locale key.** `map.titlePlanned` and `map.subtitlePlanned` were both
added by B54 and exist in all three of `content/locales/{en,de,hu}.json:315–317`,
so this was one conditional and no dictionary churn.

**The subtitle went with it.** The metadata's `description` — which is the
`<meta name="description">` *and* the sharing card's blurb — was
`map.subtitle`, "Tap any stop to see how long we stayed and what we shot
there", over a trip with no stops to tap. That is the same false claim as the
heading one line down, `map.subtitlePlanned` already exists, and the page body
already switches it. Switched here too rather than leaving half the block in
the wrong tense.

**Resolved with `currentTripRef`, not `currentTripOrRedirect`.** The page body's
helper throws a redirect, and metadata is resolved alongside the page rather
than instead of it — the page is the thing that should decide where a journal
with no current trip goes (B73). `currentTripRef` is the same
`getCurrentTrip(...)` one line lower, and it is how the day permalink's
`generateMetadata` in this same route group already resolves the current trip.
Both branches ask `getPlaces(ref).length > 0`, exactly as `MapPageContent`
asks `places.length > 0`, so the two cannot drift apart again; `getPlaces` is
cached per directory so the page does not re-read the trip.

**The neighbours do not have this shape.** Checked all four `generateMetadata`
functions under `app/[user]/(trip)/`:

- **Gallery** — the `<h1>` is `t("gallery.title")`, unconditional, and the
  metadata is `gallery.title`, unconditional. "Gallery" is tense-free and the
  two already agree. Nothing to fix, and nothing to capture.
- **Costs** — no tense split either, but a *language* one: the page renders
  `t("cost.title")` while `generateMetadata` returns the English literals
  `"Costs"` and `"What the trip costs"` and never calls `translateIn` at all,
  so a German journal's costs tab is English while the page is not. Separate
  problem, separate capture: **B130**. Its tense stays with B19.
- **The journal front page** (`app/[user]/(trip)/page.tsx`) exports no
  `generateMetadata`. Noted in B130.

**A second title/page disagreement, with a different cause.** Verifying the
reader/journal split on a running server turned up **B131**: `requestLocale()`
accepts any locale the *project* maintains (`installedLocales()`), while
`app/[user]/layout.tsx` accepts only the ones this *journal* offers
(`user.locales`). A reader carrying `fs.locale=de` onto an English-only journal
therefore gets a German `<title>` over an English `<h1>` — the same symptom as
this ticket, on every page rather than only the map, and needing a different
fix. Captured, not absorbed.

**One thing the fix discloses, and where it belongs.** The `<title>` now varies
with whether the current trip has any published days, and `generateMetadata`
does not consult `mayReadTrip` — so a stranger meeting the gate on a locked
current trip can read one bit out of the tab title. That is the same class of
disclosure as **B117** (a locked trip's title in its own `<title>`), it is
already what B54's trip-scoped route does, and `test/trip-gate.test.ts` draws
the line at metadata built from an *entry* rather than from the trip's shape.
Left as it is, deliberately; B117 is where the question gets decided.

## Acceptance

- `/<user>/map` for a journal whose current trip has no entries returns a
  `<title>` and an `<h1>` in the same tense.
- A trip with entries still reads in the past tense in both.
- The German and Hungarian dictionaries render the same pairing — this is the
  kind of fix that gets made in `en.json` alone.

---
id: B214
title: The costs page's meta description is present-tense on a trip that has not started
type: ISSUE
priority: low
complexity: low
area: i18n, costs, metadata
found: "2026-09-04T06:32:41Z"
started: "2026-09-04T09:30:24Z"
merged: "2026-09-04T10:00:32Z"
---

# B214 — The costs page's meta description is present-tense on a trip that has not started

## Why

Found while fixing B139, which gave `app/[user]/(trip)/costs/page.tsx` its
metadata in the reader's language. The `<meta name="description">` and the
sharing blurb are now `cost.subtitle`:

> Everything we spend, in CHF — from the visas and jabs before we left to
> today's coffee.

The page underneath does not say that on a trip that has not started. It picks
between `cost.subtitle` and `cost.subtitlePlanned` from `summary.hasBegun`
(`app/[user]/(trip)/costs/CostsPageContent.tsx:43`), which is B19's fix: a
costs page for a trip fourteen months away must not report spending as though
it were under way. `generateMetadata` makes no such choice, so on a journal
whose current trip is upcoming the description claims a trip in progress while
the standfirst one line below it says the opposite.

This is the same shape as B118 — `generateMetadata` deciding independently of
what the page will render — narrowed to the one field B139 deliberately did
not touch. B139 fixed the *language*; the tense was named as out of scope
there and captured here rather than absorbed.

The cost is small and presentational: a link preview and a search snippet, on
the window before a trip starts. Nothing on the page itself is wrong.

## Work

Decide the tense in `generateMetadata` the way `CostsPageContent` decides it,
from the same flag rather than from a second reading of `trip.status`. The
obstacle is cost: `getCostSummary` is not cached (`lib/costs.ts`), so calling
it in metadata doubles the work for one string. `hasBegun(trip)` from
`lib/tripTime.ts` is the cheap half of the same question and is likely enough —
it differs only for a trip marked `upcoming` that already has a day written.

Whichever is chosen, the title is unaffected: `cost.title` has one tense.

Not doing: the `<h1>`, which is already right.

## Acceptance

- On a journal whose current trip has not begun, `/<user>/costs` returns a
  description matching `cost.subtitlePlanned`, and it matches the standfirst
  the page renders.
- On a trip under way, both stay `cost.subtitle`.
- A test asserts the pairing, as `test/map-tense.test.tsx` does for the map.

## What the Why got wrong

**The state this ticket describes cannot be reached at `/<user>/costs`, and the
first acceptance line therefore cannot be demonstrated.** That is not a
quibble about wording; it changes where the defect actually is.

`getCurrentTrip` (lib/trips.ts) returns the trip declaring `status: current`,
or else the most recent `past` one — never an `upcoming` one. And `Trip.status`
has already been through `effectiveStatus` at read time, so `hasBegun` is true
for both of those: `current` is the author's own word about which trip the bare
URLs serve, and no date arithmetic takes it away (lib/tripTime.ts). Probed
against a fixture journal:

| trip.md | `getCurrentTrip` | `getCostSummary(...).hasBegun` |
| --- | --- | --- |
| `status: current`, `start: 2027-05-01` | that trip | **true** |
| `status: upcoming`, `start: 2027-05-01` | undefined → the page redirects | n/a |

So on this route the standfirst never says `cost.subtitlePlanned` either, and
the description was not contradicting it. A journal whose current trip is
fourteen months away gets the present tense in *both* places, which is B19's
own deliberate reading of `current` rather than a new defect.

Where the planned costs page does render is `/<user>/trips/<trip>/costs`, the
only address an `upcoming` trip's costs have — and that route's
`generateMetadata` describes it as "What `<trip>` actually cost", in the past
tense and in English only. That is this ticket's symptom, in the one place it
can be observed. Captured as **B250**, not absorbed: it is a different route
with a different fix (new translated copy about a named trip, rather than a
choice between two strings that already exist).

## Built

`app/[user]/(trip)/costs/page.tsx:70` now decides the tense from the flag the
page decides it from:

```ts
const trip = getCurrentTrip(user);
const begun = trip ? hasBegun(trip, getDays(trip.ref)) : false;
const blurb: TranslationKey = begun ? "cost.subtitle" : "cost.subtitlePlanned";
```

**The obstacle, and what was chosen instead of both options the Work named.**
Not `getCostSummary`: it converts every item in the trip and is not cached, so
one string would price the trip twice per request. Not `hasBegun(trip)` alone
either, which the Work offered as "likely enough" — it is the cheap half and
disagrees with the page for an `upcoming` trip that has a day written, which is
precisely the case B19 and B72 are about. `getDays(trip.ref)` is the same call
the summary makes and `getAllEntries` beneath it is cached per directory
against a fingerprint of the files, so it costs a `stat` and gives the
*identical* answer. Same trade the map page's metadata already makes.

The change is therefore a no-op in behaviour today, and deliberately so: it
replaces an assumption that happens to hold with a question that cannot come
apart if `getCurrentTrip` ever widens.

`test/costs-title.test.tsx`'s fixture gained a current trip with a day written.
It had no trips at all, which — now that the description has a tense — is the
one state where the *planned* wording is right, and is also a state where
`/costs` redirects and this metadata is never served. Its language assertions
are untouched.

## Evidence

- **Acceptance 2** (a trip under way stays `cost.subtitle`), against a
  production build of the demo journal, whose current trip is `usa-2026`:

  ```
  $ curl -s localhost:3700/example/costs | grep -o '<meta name="description"[^>]*'
  …content="Everything we spend, in CHF — from the visas and jabs before we left
  to today's coffee. Kept honest so you can judge what a trip like this really takes."
  ```

  and the `<p>` under the `<h1>` is that same sentence, character for character.

- **Acceptance 3** — `test/costs-tense.test.tsx`, which renders the standfirst
  rather than restating it, in all three languages. Three of its ten cases fail
  against the old file and all ten pass against the new one.

- **Acceptance 1 is not demonstrated**, and the table above is why: there is no
  journal whose *current* trip has not begun. What the test asserts instead is
  the pairing itself, plus the only reachable planned state (no current trip at
  all, where the page redirects to the trip list and the planned wording is the
  one that claims less — the same choice the map page's metadata documents).
  A person deciding this ticket is done should read B250 alongside it.

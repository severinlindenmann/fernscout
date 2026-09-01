---
name: add-a-trip
description: Scaffold a new Fernscout trip — the folder, trip.md, and optionally costs.md and plan.md. Use when the user says "start a new trip", "add a trip", "set up next year's journey", or wants an upcoming trip with a planned route and a budget.
---

# Add a trip

A trip is a folder. Creating one is creating `trip.md`; everything else is
optional and can arrive later.

```
content/<user>/trips/<trip-id>/
  trip.md          required
  entries/         created empty, filled by add-a-day or ingest-photos
  costs.md         optional — budget and preparation spending
  plan.md          optional — planned stops, for an upcoming trip
  media/           created by ingest
```

## Steps

### 1. Decide the id and the owner

```bash
ls content/                       # who is on this instance
ls content/<user>/trips/          # what they already have
```

The id is the URL segment: lowercase letters, digits and dashes, starting with
a letter or digit (`lib/trips.ts` `ID_RE`). It must be unique **within that
user**, not across the instance. Anything else is rejected at read time and the
trip simply does not appear, with a warning in the console.

Ask for the id if the trip's name is ambiguous. `japan-2027` ages better than
`the-big-one`.

### 2. Write `trip.md`

```bash
mkdir -p content/<user>/trips/<trip-id>/entries
```

```markdown
---
id: <trip-id>                 # must equal the folder name
title: "Japan 2027"
tagline: "Six weeks, mostly by train"
start: "2027-04-01"
end: "2027-05-15"
status: upcoming              # upcoming | current | past
accent: sky                   # sky | yellow | green | coral | navy
people:                       # who took it — 0 to 10. Empty means the owner,
  - name: "Alex Berger"       # alone. Everyone listed may write to the whole
    email: "alex@example.com" # trip, and may hold a token scoped to it.
visibility: public            # private | public | guest
listed: true                  # optional — whether it is advertised at all
costsVisibility: public       # public | guests
rates:                        # this trip's frozen local → baseCurrency rates
  JPY: 0.0057
---

A paragraph about what this trip is. It renders as the trip's introduction.
```

Four fields decide behaviour rather than decoration:

- **`status`** — exactly one trip should be `current`. That is the one served at
  the bare `/<user>` URLs; the rest live under `/<user>/trips/<id>`.
- **`people`** — everyone listed may write to the *whole* trip and may obtain an
  agent token scoped to it and to nothing else in the journal. Up to ten. Leave
  it out for a trip somebody took alone. Everyone listed is also **published**
  — their full name appears in the trip's structured data and in the costs
  disclaimer on a public trip. This is not a quiet way to hand somebody write
  access; if that's all they need, that is not what this field is for.
- **`visibility`** — who is let in. `private` is the people above and the
  journal's owner; `public` is everyone; `guest` is everyone the owner has let
  into the *journal* — every approved contact — plus the people above. An
  unrecognised value reads as **`private`**, never as public: a typo must not
  publish somebody's trip.

  Say it to the person in these words, because it is the choice they get wrong:
  **`guest` means the people I let into this journal; `private` means only the
  people who were there.** Approving one contact opens every `guest` trip in the
  journal to them; a trip that has to be held back from them is `private`.

  A `guest` trip may also carry a `passwordHash:` — set it with
  `npm run trip:password` rather than by hand — which is the anonymous door for
  somebody who was sent a password rather than approved. It is optional: an
  approved contact opens the trip without one.

  `listed:` is a separate question — whether the trip is advertised in the
  sitemap, the feed and the switcher. The two older words still parse:
  `password` means a `guest` trip, and `unlisted` means `public` with
  `listed: false`.
- **`rates`** — how much one unit of a local currency was worth in the site's
  `baseCurrency` **on this trip**. Frozen per trip on purpose: a later trip to
  the same country carries its own table and never restates what this one cost.

### 3. Optional — a budget (`costs.md`)

```markdown
---
budget:
  total: 12000
  days: 45
  currency: CHF
costs:
  - label: "Rail pass"
    amount: 420
    category: preparation
---

# Preparation

What was spent before leaving.
```

### 4. Optional — a planned route (`plan.md`)

Only meaningful while the trip is `upcoming`; it draws the planned line on the
map before any entry exists.

```markdown
---
route:
  - { location: "Zurich", country: "Switzerland", countryCode: "CH", lat: 47.3769, lng: 8.5417 }
  - { location: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6762, lng: 139.6503, note: "Two weeks" }
---

Prose about the plan.
```

The key is **`route:`** and each stop's name is **`location:`** — check
`lib/plan.ts` if in doubt. A stop missing `location`, `lat` or `lng` is dropped
silently, and a whole plan under the wrong key reads as no plan at all, with no
error anywhere. Verify it rather than assuming:

```bash
npx tsx --conditions=react-server -e \
  'import("./lib/plan.ts").then(m => console.log(m.getPlan("<user>/<trip-id>")))'
```

A stop counts as reached once an entry exists within 75 km of it — generous on
purpose, because "Zurich Airport" is 11 km from "Zurich".

### 5. Verify

```bash
npx vitest run test/trips.test.ts
npm run dev      # then open /<user>/trips/<trip-id>
```

A trip with no entries renders as an upcoming trip: the countdown, the planned
route if `plan.md` exists, and the budget if `costs.md` does. If the trip does
**not** appear at all, the cause is nearly always the id — folder name and `id:`
must match, and both must satisfy the pattern above.

Copy a demo trip if you want a working shape to edit rather than a blank page.
`content/example/trips/alps-2024/` is the smallest — a `trip.md`, a `costs.md`
and a `plan.md` to read side by side. For an **upcoming** trip copy
`content/example/trips/japan-2027/` instead: it is the one with no entries, so
it shows what a countdown page is actually built from, including stops with
`note:` and two future-dated drafts extending the route on the owner's map.

Both are written by `scripts/build-demo-content.mjs`. If you change what the
demo content is meant to demonstrate, change it there and re-run it — hand
edits to `content/example/` are lost the next time somebody does.

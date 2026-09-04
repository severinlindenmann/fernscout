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
# status: current             # optional, and only for the one trip served at
                              # the bare /<user> URL — see below
accent: sky                   # sky | yellow | green | coral | navy
people:                       # who took it — 0 to 10. Empty means the owner,
  - name: "Alex Berger"       # alone. Everyone listed may write to the whole
    email: "alex@example.com" # trip, and may hold a token scoped to it.
visibility: public            # private | public | guest
# listed: false               # optional, and only ever narrows — see below
costsVisibility: public       # public | guests
rates:                        # this trip's frozen local → baseCurrency rates
  JPY: 0.0057
---

A paragraph about what this trip is. It renders as the trip's introduction.
```

Five fields decide behaviour rather than decoration:

- **`status`** — exactly one trip should be `current`. That is the one served at
  the bare `/<user>` URLs; the rest live under `/<user>/trips/<id>`. It is the
  only value worth writing: `past` and `upcoming` are worked out from `start`
  each time the site reads the trip, so a trip that has begun shows its days
  and one that has not shows a countdown, whatever the file says. Writing
  `upcoming` into a trip whose dates have passed does nothing — which is
  deliberate, because until B72 that one word hid every day published into
  such a trip.
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

  **A closed trip is not named to whoever asks for its URL.** The sign-in gate
  carries the journal's title and nothing of the trip, in the browser tab as
  well as on the page (B117). What a guessed id still reveals is that *a* trip
  exists at that address, and that is deliberate — a person who was invited and
  meets a 404 has nowhere to go. So choose ids for the people who will type
  them, and choose titles as if only the people in `people:` will ever read
  them.

  There is no password, and no other door. A closed trip asks the reader for
  their e-mail address and mails them a way in; whether that lets them read it
  is decided by the trip's `people:` list and by the owner having approved
  them. **Never write a `passwordHash:` line** — the server refuses to start on
  one, because a line that used to lock a trip and no longer does is worse than
  no line at all.

  `listed:` is a separate question — whether the trip is advertised in the
  sitemap, the feed and the switcher. **It only ever narrows.** Leave it out
  and `visibility` decides: a `public` trip is advertised, and a `guest` or
  `private` one is not. Write `listed: false` on a public trip and you get the
  old `unlisted` — readable by anybody holding the link, advertised nowhere,
  which is the honest setting for a trip you will mail to the family and would
  rather a search engine did not find. Writing `listed: true` on a trip that no
  visibility advertises does not advertise it: the parser refuses it and says
  so in the server log, because the field is about advertising and never about
  access, and a key that quietly changed nothing is what B51 was.

  The two older words still parse: `password` means a `guest` trip, and
  `unlisted` means `public` with `listed: false`.
- **`costsVisibility`** — who, among the readers already allowed to open the
  trip, may see what it cost. `public` (the default, and what leaving the key
  out means) shows the numbers to everybody who can read the trip; `guests`
  narrows them to the people in `people:` and the readers the owner has
  approved into the journal. It is not a second `visibility:` — it decides
  nothing about who may open the trip, only whether the money is drawn once
  they are in, and on a `private` trip it changes nothing because everyone who
  can read it was already on it.

  An unrecognised value reads as **`guests`**, not as public: the fail-closed
  end of this axis is the quiet one. Writing it through the API — `POST
  /api/v1/<user>/trips` — a value neither word is refused rather than
  defaulted, because defaulting it would be a silent decision about
  somebody's money (B178).
- **`rates`** — how much one unit of a local currency was worth in the site's
  `baseCurrency` **on this trip**. Frozen per trip on purpose: a later trip to
  the same country carries its own table and never restates what this one cost.

  **Nothing generates this number, and it is easy to write upside down.**
  `JPY: 0.0057` reads "1 JPY = 0.0057 CHF" — units of the *base* currency per
  one unit of the keyed currency, so a currency worth less than the base
  currency gets a small number. That is the opposite of the convention
  `content/rates/ecb.json` and `npm run rates:update` use, which is units per
  one euro; writing an ECB figure in here converts nothing correctly and
  reports no error. Ask the author for a rate from the middle of the trip,
  best taken from a card statement or a withdrawal receipt — the amount
  debited divided by the amount received, which is what the money actually
  cost them. Failing that, an ECB rate for a date in the middle of the trip.
  Never today's rate for a trip in the past.

  Leaving a currency out is a supported state, not a failure: costs in it are
  reported on the page as "not counted in these totals" rather than converted
  at a guess. An empty `rates:` beats a number nobody can defend — the same
  rule as everywhere else here. `docs/currencies.md` has the full picture.

Two more keys the reader understands, and one of them is the only field of a
`trip.md` that no call can write:

- **`translations`** — the trip's title and tagline in the journal's other
  languages, keyed by locale:

  ```yaml
  translations:
    de:
      title: "Japan"
      tagline: "Sechs Wochen mit dem Zug"
  ```

  Only worth writing for a locale the journal actually declares in its own
  `config.json`; anything else is written and never rendered. Over the API a
  locale the journal does not speak is refused rather than written, and says to
  add the language first.
- **`cover`** — the picture the trip shows on `/<user>/trips` and in its
  sharing card, as a path under the trip's own media: `cover:
  /media/<trip-id>/hero.jpg`. **This is the one field you write by hand.**
  `POST /api/v1/<user>/trips` and `create_trip` deliberately do not take it
  (B207): a trip has no photographs at the moment it is created — media has to
  be attached to a day, and there are no days yet — so any value they could
  accept would name a file that is not there, and the trips index would draw a
  broken image rather than none. Add the line once the photographs are in, at
  the file. B245 is the call it should eventually live on.

Everything above except `cover` can also be sent to `POST
/api/v1/<user>/trips` or `create_trip` when the trip is created, which is the
only moment any of it can be set: there is no call that edits a `trip.md`
afterwards, so a `people:` list or a `rates:` table sent wrongly is corrected
here, in the file.

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

Writing the file tells you nothing about that: it succeeds whatever is in it,
and a `trip.md` the site refuses drops out of every read. Ask what the site
made of it rather than assuming it took —

```bash
npx tsx --conditions=react-server \
  -e 'import { getMalformedTrips } from "./lib/trips"; console.log(getMalformedTrips("<user>"))'
```

— or, against a running site, `GET /api/v1/<user>/trips`, where the same answer
comes back under `malformed`. An empty list means the trip parsed. The owner is
told on `/<user>/trips` as well, so somebody who runs neither still finds out
(B83).

Copy a demo trip if you want a working shape to edit rather than a blank page.
`content/example/trips/alps-2024/` is the smallest — a `trip.md`, a `costs.md`
and a `plan.md` to read side by side. For an **upcoming** trip copy
`content/example/trips/japan-2027/` instead: it is the one with no entries, so
it shows what a countdown page is actually built from, including stops with
`note:` and two future-dated drafts extending the route on the owner's map.

Both are written by `scripts/build-demo-content.mjs`. If you change what the
demo content is meant to demonstrate, change it there and re-run it — hand
edits to `content/example/` are lost the next time somebody does.

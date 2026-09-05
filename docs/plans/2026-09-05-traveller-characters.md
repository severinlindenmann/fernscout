# The travellers are whoever went

*Written 2026-09-05, before the work, as the record of what was intended. Not
corrected afterwards — see `docs/README.md`. The task is B11.*

## What was asked for

A trip should be able to say what the people on it look like. Not two figures
drawn once as a likeness of one particular couple, but a party: one person or
five, adults and children, hair and skin and clothes and a hat, chosen by the
people themselves and drawn on their own journal.

And the way it gets chosen is a conversation. The agent asks *how would you
like to be drawn*, the person answers in words, the agent reads back what it
understood, and only then does anything reach the file. There is no character
editor in the browser and there will not be one (decision 24) — this is the
same shape as everything else here: the agent is the editor.

## Where it stands today

`components/Travelers.tsx` has two module constants and a comment that is
honest about them:

```ts
// Us: two white European travellers — him with short brown-blond hair, her
// with long brown hair. Tweak these if you want to fine-tune the likeness.
const HIM = { skin: "#f7d7bb", hair: "#a67c42", … };
const HER = { skin: "#f9dcc4", hair: "#6b4423", … };
```

`Travelers` takes one prop, `size`. Its two callers —
`components/TravelScene.tsx:111` and `components/TripHero.tsx:210` — pass only
that. So a solo traveller's journal shows two people, a family of five shows
two people, and anybody who is not white shows two white people, on the first
screen, before a word has been read.

## The seven decisions

Everything below follows from these, and each was a real choice rather than
the obvious one.

### 1. The file stores attributes, never a region

The request names presets like "asian, european, afro american". Those are
useful for **picking** and wrong for **storing**.

A preset is a starting point that resolves the moment it is chosen, into plain
attributes — a skin tone, a hair colour, a hair style. What lands in `trip.md`
is `skin: deep, hair: black, hairStyle: coils`. What never lands in `trip.md`
is `preset: afro-american`, because that is a sentence about somebody's
ethnicity written into a file the owner did not think they were writing it
into, and because it is not even true: the preset was a first guess that the
person then corrected.

So presets exist in `lib/travellers/presets.ts` and in the API that lists them.
They exist nowhere on disk under `content/`.

This also settles what the presets may be *called*, which is the part that
carries the risk. They are labelled as **starting points** and named for
regions only as a discovery aid — `east-asian`, `south-asian`,
`southeast-asian`, `west-african`, `east-african`, `north-african`,
`european`, `mediterranean`, `middle-eastern`, `latin-american`, `pacific`,
`indigenous-american`. The list is deliberately longer than the three in the
request and deliberately not a taxonomy of people. Each is one common
combination out of many, the UI copy and the agent script both say so, and
correcting one is the expected outcome rather than a failure.

### 2. Cosmetics do not go in `people:`

The tempting shape is `people: [{ name, email, figure: {…} }]`. It is wrong,
and `lib/trips.ts:139` says why:

> Fails **closed**: any malformed entry drops the whole list rather than a
> single line, because a half-parsed list of people is a half-parsed list of
> who may write to the journal.

`parsePeople` returns `[]` on any bad entry, and `people:` is a write-access
list. Put a hair colour in there and a typo in a hair colour revokes
everybody's write access to the trip. A cosmetic field must never be able to
do that.

So there is a separate `travellers:` block, with its own parser, which fails
**open** in the opposite direction: a malformed figure falls back to the
neutral default and the rest of the party still draws. The two blocks are tied
together by an optional `for:` carrying an email that appears in `people:`, so
the byline and the figures can agree without the parsers ever meeting.

### 3. There is no `gender` field

The request lists gender among the options, and this is the one place the plan
does not do the literal thing. Stated plainly so it can be overruled.

Everything gender would control is already an attribute the person chose
directly: hair style, hair length, clothing colours, build. A separate
`gender:` field would either be decorative — two values that only set hair
length, which the person can set — or it would make the software assert
something about a person from a cartoon, and force a non-binary traveller
through a two-way switch to get drawn at all.

So gender lives where the request actually needs it, which is in the
**picking**. Starting points are labelled by presentation — an agent can offer
"a feminine-presenting south-asian starting point" — and what resolves out of
it is hair, clothes and build. `build: slight | average | broad` carries the
silhouette. If the author wants the field anyway, it is one line in the schema
and this paragraph is the argument against it.

### 4. Age is a scale, and it is the only thing that is

B11 asks for "a family with children at a smaller scale". `age: child | teen |
adult | elder` maps to a height multiplier and to nothing else automatic —
elder does **not** silently grey the hair, because a person with an unchanged
head of black hair at seventy should not have to fight the renderer. Grey is a
hair colour like the others, chosen or not.

### 5. One renderer, three consumers

`lib/travellers/render.ts` is a pure function: a `Figure` in, SVG element
markup out. No React, no `motion`, no DOM.

- `components/Travelers.tsx` wraps it in `motion.svg` for the walk cycle.
- `GET /api/v1/<user>/travellers/preview?…` returns it as `image/svg+xml`, so
  an agent working over the network can **show** somebody their figure instead
  of reading hex codes down a phone. This is the "visualize them" half of the
  request and it is what makes the interview in decision 7 honest.
- A node script renders a sheet of the whole party to a file, for an agent
  working on disk that has no server running.

The alternative — the drawing living inside the component — is what makes the
preview impossible without booting Next, and the preview is not a nice-to-have
here. A person cannot confirm a description they cannot see.

### 6. A composition, not a row

Five figures at 76px is 380px and a phone hero is narrower than that, so the
layout takes a container width and solves for scale: figures shrink together
to a floor of about 60% of the nominal size, and the gap closes as the party
grows — generous for two, nothing for four, a real overlap at six and up.

But scale alone gives a police line-up, and a party of five is not standing
for a photograph. **The party arranges in two ranks.**

- **Children and teenagers take the front rank.** They are shorter by
  `AGE_SCALE`, so behind an adult they would simply be gone. This is the rule
  that matters and it fires at any size: two parents and two children is four
  figures with the children in front, not a row of four.
- **With no children and four or more figures, the ranks alternate** — a group
  of five friends stands some in front, some behind. One to three adults stay
  a single row: a couple side by side should not be staggered into a tableau.
- **The front rank sits half a figure across**, in the gaps of the back rank,
  so nobody is squarely hidden by the person in front.
- **Depth is three small things together**: the front rank is drawn last so it
  overlaps, offset a few pixels lower on the ground (nearer the viewer means
  lower on the horizon), and scaled about 6% up against the back rank's 6%
  down. Any one of the three alone reads as a mistake; together they read as
  distance.

**The arrangement is derived, never random.** Rank and offset come from the
figure's index in the list, so a trip renders identically on every load and in
the photobook. A layout that reshuffles on refresh is a bug that looks like a
feature for about a day.

The per-figure gait delay stays — B11 is right that a group bobbing in
lockstep looks like a bug — and it is derived from the same index, so the
front rank does not accidentally bob in unison.

### 7. The agent asks, and records the answer

B11 currently rules this out:

> Generating a figure from a free-text description is out of scope — an agent
> choosing somebody's appearance from a prompt is exactly the kind of
> invention `AGENTS.md` forbids.

That is too broad, and the distinction it misses is the whole feature. The
rule in `AGENTS.md` is that **what happened** is never an agent's to decide —
no weather nobody mentioned, no meals nobody ate. A person answering "short
black hair, glasses, I usually wear green" is not an agent inventing anything;
it is the person telling the agent a fact about themselves, which is the one
thing the agent is for.

What stays forbidden, and goes into the skill in as many words:

- **No inference from a name.** A French-sounding name says nothing about
  anybody's hair.
- **No inference from a photograph.** The trip is full of pictures of these
  people and the agent must not look at one to decide this. It is a guess
  about a person from an image, presented to their family as their own choice.
- **No inference from a country.** A trip to Vietnam does not populate the
  party.
- **No filling in the gaps.** An attribute nobody answered gets the neutral
  default, not a plausible one. Somebody who says "short dark hair" and stops
  gets the default skin tone, and the agent says so rather than picking one.

The interview itself, as a new `.claude/skills/describe-a-traveller/` and a
section in `/agent.md` for the network side:

1. Ask who is on the trip. (`add-a-trip` already does.)
2. For each person, ask once, openly: *how would you like to be drawn?* Not a
   twelve-question form — one question, and the person answers with as much or
   as little as they like.
3. Map the answer to attributes. Offer a starting point when the answer is
   sparse, as an offer: "there is a `south-asian` starting point — shall I
   begin from that and change the hair?"
4. **Render it and show them.** The preview endpoint from decision 5.
5. Read back what was set *and what was left at the default*, in words.
6. Write only after they say yes.

Step 4 is what stops this being an agent's description of somebody. Step 5 is
what stops a silent default reading as a choice.

## The schema

`travellers:` in `trip.md`, and the same block in the journal's
`content/<user>/config.json` as the default party for trips that do not
override it. Absent everywhere means one neutral figure — **not** the current
two.

| Field | Values | Default |
| --- | --- | --- |
| `for` | an email in `people:`, optional | — |
| `skin` | `light` `light-medium` `medium` `medium-deep` `deep` `rich`, or a hex | `medium` |
| `hair` | `black` `dark-brown` `brown` `auburn` `red` `blond` `grey` `white`, or a hex | `dark-brown` |
| `hairStyle` | `buzz` `short` `tousled` `long` `curly` `coils` `braids` `bun` `ponytail` `bald` `headscarf` | `short` |
| `eyes` | `brown` `dark-brown` `hazel` `green` `blue` `grey` | `brown` |
| `shirt` | palette token or hex | rotates through the brand palette by index |
| `pants` | palette token or hex | `slate` |
| `pack` | palette token or hex, or `none` | rotates |
| `build` | `slight` `average` `broad` | `average` |
| `age` | `child` `teen` `adult` `elder` | `adult` |
| `accessories` | list of `glasses` `sunglasses` `hat` `cap` `beanie` `scarf` `camera` `stick` | `[]` |

Ten figures maximum, matching `MAX_TRIP_PEOPLE`, and for the same reason: past
that it is not a party, it is a crowd scene that does not fit the hero.

Named tones rather than raw hex is B11's point 2 — "so an author picks rather
than mixes hex codes" — and hex stays legal as the escape hatch, because a
person describing their own hair should be able to be exact about it.

**`eyes` is nearly invisible at hero size.** Two 2px circles in a 64×96
viewBox. It is in the list because it was asked for and because it reads at
the sizes the preview and the photobook use, and the interview should not
spend a question on it.

## The drawing

The existing figure is good and is not being redrawn — this is a
parameterisation of it, plus layers. Painter's order, which is most of the
work:

1. shadow ellipse
2. long hair, behind the body
3. backpack
4. legs, feet
5. torso, with the darker yoke
6. arms, hands
7. head
8. hair, front
9. eyes, mouth, cheeks
10. **accessories** — scarf at the neck, glasses over the eyes, hat over the
    hairline, camera on a strap across the torso, stick in the near hand

`headscarf` is a hair *style* rather than an accessory because it replaces the
hair rather than sitting on it, and the two would fight over layer 8.

## Reachable by agent

B11 asks for this and names MCP, which B298 removed. The REST equivalents:

- `GET /api/v1/<user>/travellers/presets` — the starting points and the
  vocabulary, so an agent offers what exists instead of inventing a hex code.
- `GET /api/v1/<user>/travellers/preview?…` — decision 5.
- `POST`/`PATCH` on the trip accepts `travellers:` and round-trips it through
  `lib/tripWrite.ts`.

Nothing here is owner-only. A trip-scoped token belongs to somebody on the
trip, and how they are drawn on it is theirs.

## Not doing

- **A character editor in the browser.** Decision 24, and B11 says it too.
  The preview is read-only; there are no controls on it.
- **Per-entry figures.** The party is the trip's, not the day's.
- **Faces from photographs.** Decision 7, and it is the line that matters
  most.
- **Animating anything but the existing walk cycle.** The gait offset is the
  whole animation budget.

## Acceptance

Carried into B11, and unchanged from what is there except where the decisions
above extend it:

- A journal configured with one traveller shows one figure; five shows five,
  laid out without overflowing the hero on a phone.
- No skin or hair colour is a module constant in `Travelers.tsx`.
- A malformed `travellers:` entry draws the neutral default and **does not**
  affect `peopleOf()` — a test asserts write access survives a broken hair
  colour.
- No file under `content/` contains a preset name.
- `GET …/travellers/preview` returns an SVG for a figure given in the query.
- A journal with no `travellers:` configured still renders, and `npm run
  build` prerenders the demo journal as before.

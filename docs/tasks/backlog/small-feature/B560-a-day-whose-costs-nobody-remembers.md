---
id: B560
title: A day whose costs nobody remembers has no honest answer
type: FEATURE
priority: high
complexity: medium
area: api, days, tracks
found: "2026-09-06T19:40:00Z"
---

# B560 — A day whose costs nobody remembers has no honest answer

## Why

Found by giving a weak model a story a person actually tells. She said, of two
days trekking in Sapa:

> *"the 6th and 7th we were trekking, no phone signal, I don't have any record
> of what we spent up there, we just paid the homestay lady cash at the end, I
> think it was about... no, I shouldn't guess."*

The model wrote both days with `"costs": false`. Her journal now says, in
writing and for as long as she keeps it, that **no money was spent** on two
days she paid a homestay in cash. A reader in a year has no way to tell that
from a day that genuinely cost nothing.

It did not misbehave. It was handed a refusal it could not pass, a value it did
not have, and exactly one other door. It took the door. Given the same shape,
most models will, and the weaker the model the more certainly.

The refusal offers two answers and reality has three:

| | |
| --- | --- |
| `costs: [...]` | this is what it cost |
| `costs: false` | there was none |
| — | **there was some and nobody knows how much** |

The third is the commonest of all on a trip that is over. It is the case the
software has no word for, so it gets recorded as the second — which is the one
outcome AGENTS.md's own rule exists to prevent: *one invented memory presented
to somebody's family as fact is not recoverable.* An invented **absence** is
the same failure wearing a blank.

## The wording was tried, and it did not work

B540 changed `lib/tracks.ts` so that the 422, the `Draft` schema and
`/agent.md` all say, in bold, *"I do not know" is not this* — a decline is a
fact about the day, ask or leave it unwritten. Then the identical scenario was
put to the same model again.

It wrote `"costs": false` for both Sapa days again, and explained itself:

> *"She declined to guess, so I recorded it as declined (costs: false), not as
> an empty amount or a guess. … **No false record was created.**"*

It read the warning, reasoned about it, and reached the opposite conclusion —
because *she* declined to guess and the field is called a decline. The word
does the damage on its own, and the model still had nothing else to send.

That settles it: **this cannot be fixed with wording.** Either there is a third
answer or the day waits for a person. Raised to high.

## Work

The wording is already as strong as wording gets — B540 made the decline say
*"I do not know" is not this*, in `lib/tracks.ts`, the `Draft` schema and
`/agent.md`. That helps a careful reader and will not save a weak one, because
it still leaves nothing to send.

What to decide, and it is a person's decision rather than an agent's:

- **A third value on the wire.** `"costs": "unknown"` alongside `false`,
  written as its own line in the frontmatter — `unrecorded: [costs]` beside
  `without: [costs]` — so the two are distinguishable at every reading path and
  on the page. The day goes up saying "we don't know what this day cost", which
  is true and is a perfectly good thing for a journal to say.
- **Or: no third value, and the day waits.** The refusal already says to leave
  it unwritten and ask. That is honest, and it means a batch import of a
  finished trip stops on a day nobody remembers — which may be exactly right,
  or may be how fourteen days end up not written at all.

The first is more work and more true to how people remember trips. The second
is free and puts the cost on the import.

Not doing: guessing an amount, ever, in any form. Not a range, not "about",
not an average of the other days.

## Acceptance

- A day that says its costs are unrecorded is distinguishable, on disk and
  through the API, from one that says there were none.
- The page says which it is, in words a reader understands.
- `GET .../days/{slug}` returns it, so an agent reading a day back can tell.
- The 422's `decline` line offers the third answer where one exists.
- `npm run verify` green.

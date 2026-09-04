---
id: B325
title: A day carries coordinates and a date but no way to say what the weather actually was
type: FEATURE
priority: medium
complexity: high
area: entries, ingest, ui, capabilities
found: "2026-09-04T17:41:12Z"
---

# B325 — A day carries coordinates and a date but no way to say what the weather actually was

## Why

Asked for by the author, 2026-09-04.

A day already carries the two things that identify a point in space and time:
`date`, required, and `lat`/`lng`, optional and validated as a pair
(`lib/validate/entry.ts:171`). B267 made coordinates something an agent is
asked for on every day (`COORDINATES_QUESTION` in `lib/api/agentCopy.ts`),
precisely so the map has something to draw. Those same two values are enough to
look up, from a public archive, what the weather at that place on that day
actually was.

Nothing does. A day has no weather field, no source for one, and no way to show
one.

**This is the one place where the project's central rule points the other way,
and that is the argument for building it rather than against.** AGENTS.md is
blunt: *"No weather nobody mentioned"* — an agent writing "it was a warm
evening" into somebody's journal because it read well is inventing a memory and
presenting it to that person's family as fact. The rule is right and stays.

But it currently forbids the *only* route to a true statement about the
weather, because guessing is the only route available. A measured observation
from an archive, at a coordinate the person supplied, on a date they supplied,
labelled as coming from that archive, is not the thing the rule prohibits — it
is the thing the rule exists because we could not otherwise have. What makes it
safe is the labelling: it must never become prose, and it must never be
indistinguishable from what the person wrote.

There is real value in it beyond decoration. A journal is read years later, and
"14°C and raining all day" is the kind of detail nobody writes down at the time
and everybody wants back. It is also the honest answer to a question the model
already invites: an agent that has been handed a coordinate and a date has been
handed everything it needs to be tempted.

## Work

Design work first — this is a `docs/plans/` task before it is a diff, and the
plan is where the decisions below get made rather than in review.

**The source.** Open-Meteo is the obvious candidate and should be evaluated
first: its historical archive API is free for non-commercial use, needs no API
key, takes a lat/lng and a date, and its data is ERA5 and other public
reanalysis. No key is the important property — every other capability here is
off by default and must be *absent rather than broken* when disabled
(`lib/capabilities.ts`), and one that needs no secret is one a self-hoster can
actually turn on. Check the licence and the attribution it asks for before
committing; whatever is chosen, the attribution goes on the page.

**When it is fetched, and the answer is not "at render time".** A page that
calls a third party while a reader waits is a page that is as slow and as
available as that third party, and this site renders statically wherever it
can. Fetch once, when the day is written or shortly after, and store the result
in the day's own frontmatter — the content is a folder the author owns
(AGENTS.md), and weather that lives only in a cache is weather that disappears
when the cache does. Note that the archive lags real time by a few days, so a
day written the evening it happened cannot be filled in immediately; decide
whether that is a later backfill pass or simply an empty field.

**What is stored.** Enough to render and to be checked: a temperature range, a
condition code, precipitation, and — not optional — **which source it came from
and when it was fetched**. A number in a file with no provenance is a number
somebody will eventually take for something the author wrote.

**How it is shown, and what "animated" has to survive.** The request is for a
nice animated presentation per day. Constraints that are not negotiable:
`prefers-reduced-motion` must turn it off; it must be legible in both themes;
it must not be the reason a day's page ships a JavaScript bundle it otherwise
would not; and it must never sit inside the prose. Beside the date, in the
day's own furniture, where a reader can see at a glance that it is the site
speaking and not the author. Consider that a trip page shows many days at once
— whatever animates has to be bearable forty times on one screen.

**It is a capability, off by default.** `lib/capabilities.ts` decides, and
`/api/health` explains why it is off. A journal that never turns it on must
have no weather anywhere, not an empty box on every day.

**Two hard edges to write into the plan.**

- **A day with no coordinates gets nothing.** Not a guess from the trip's other
  days, not the nearest city, not the country. The pair is already all-or-
  nothing in the validator and this follows it.
- **The agent must not be able to write this field from its own knowledge.**
  If the API accepts weather as an input, an agent asked to "add the weather"
  will supply what it believes rather than what was measured, and the whole
  distinction collapses. Either the server fetches it and the field is not
  writable through the API at all, or writing it requires the source and
  timestamp and the server verifies them. Prefer the first — it is the reading
  of the one rule that cannot be got around.

Not doing: forecasts for an upcoming trip (a different feature, and `plan.md`
is where it would live); weather on the map; and any use of this data to
generate prose.

## Acceptance

- A day written with `lat`/`lng` and a date ends up with weather in its
  frontmatter, naming the source and when it was fetched.
- The day's page shows it, beside the date and not inside the prose, with the
  source credited.
- `prefers-reduced-motion: reduce` renders it without animation.
- A day without coordinates shows nothing, and the page does not reserve a
  space for it.
- The capability off: no weather is fetched, none is rendered, no request is
  made to any third party, and `/api/health` says why.
- No API call can put a weather value on a day from a caller's own assertion —
  covered by a test, because this is the line the whole ticket rests on.
- A `docs/plans/` document exists naming the provider chosen, its licence, and
  the attribution it requires.

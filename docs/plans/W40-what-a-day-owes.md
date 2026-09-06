# W40 — What a day owes

An agent moved a finished ten-day trip onto a hosted instance: fourteen days,
seventy-five photographs, a budget. Everything it sent was accepted. The owner
opened the costs page and found no per-day spending on it, and no day showing
what it cost.

Nothing had failed. The agent had listed the entries on disk through a filter
of its own — title, date, place, coordinates — seen no `costs:` in what its
own filter had printed, concluded there were none, and written fourteen days
without them. Twenty-two cost lines across seven days stayed on the laptop.
Every call answered `200`.

That is the shape of the problem this plan is about, and it is not really
about money:

> The agent's mistake was ordinary. What made it expensive is that **nothing
> in the system disagreed with it.** A day is accepted with whatever it
> happens to carry, so an omission and a deliberate blank are the same
> request, and a trip that is keeping track of something has no way to say so.

Written before the work. Not corrected afterwards — see `docs/README.md`.

---

## The one thing already built this way

`translations` is the exception, and it is the model for everything below.

A journal declares its languages. A day written into a journal that declares
two and carries one is **refused** — `checkTranslations`, `lib/validate/entry.ts`
— with the languages it owes named in the refusal, and the way out spelled
out: send the words, or narrow the journal's `locales`. B294 built it after a
journal asked for three languages and got one.

Nobody has to remember `translations`. The system remembers, and says so at
the moment the day is written.

Every other thing a day can carry — money, a place on the map, photographs —
is remembered by nobody.

## The shape

**A trip declares what it is keeping. A day satisfies it or declines it in
words. Everything is on by default.**

Three moving parts.

### 1. `tracks:` on the trip — what this journey is keeping

```yaml
tracks:
  costs: true
  location: true
  photos: true
```

Absent means **all of them on**, which is the default the owner never has to
find. A trip that is not about money says `costs: false` once, on the trip,
rather than every day saying nothing and hoping.

The list is a registry in one module rather than a hard-coded set, because
the weather feature being built alongside this is the next row in it, and the
day after that there will be another.

### 2. A day satisfies it, or declines it by name

`POST .../days` refuses a day that is missing something the trip tracks:

```json
{
  "error": "incomplete_day",
  "message": "This trip keeps track of what it costs, and this day says nothing about money…",
  "missing": [
    {
      "field": "costs",
      "why": "This trip tracks costs — 7 of its 13 days carry them.",
      "send": "costs: [{\"label\": \"Dinner\", \"amount\": 42, \"currency\": \"EUR\"}]",
      "decline": "\"costs\": false — this day cost nothing, or nothing worth recording"
    }
  ]
}
```

**`"costs": false` is the whole escape hatch**, and it is deliberately a
sentence somebody has to mean. It is not "skip validation": it is the day
saying *there was no money on this day*, which is a fact about the day and
belongs in the file. It is written as `without: [costs]` in the frontmatter,
so reading the day back a year later still distinguishes "nothing was spent"
from "nobody asked".

An agent that has not asked has one honest move, and it is the one this whole
product is built on: **go and ask.**

### 3. Photographs are checked at publish, not at write

A day cannot carry photographs at `POST` — media is a second call, by design,
and the media endpoint refuses a batch that names no day. So `photos` is
checked where it can be: `POST .../publish` refuses a day with no photographs
on a trip that tracks them, with the same two ways out.

That makes publish the second gate rather than a separate mechanism: it
re-runs the whole contract, so a day written before its trip started tracking
something is caught on the way to the site rather than never.

## What this is not

- **Not a schema validator.** The shape checks in `lib/validate/entry.ts` stay
  exactly as they are. This is a *completeness* check, and it is a different
  question: those say "that is not a number", this says "you did not ask".
- **Not retroactive.** Days already on disk are not rewritten and not
  re-refused. The contract runs on writes and publishes from here on.
- **Not a way to make an agent invent things.** Every refusal offers the
  decline as an equal answer, and none of them says "make something up". An
  empty field still beats an invented one; the point of the refusal is that
  **asking** is the third option, and it is the one that was skipped.

## Why refuse rather than warn

A warning inside a `200` is a warning nobody reads. The run this came from
answered `200` fourteen times, and the person found out by looking at their
own website a day later. A refusal costs one round trip and cannot be missed.

The risk is an agent that cannot get a day in at all and gives up, or starts
inventing values to satisfy the gate. Both are answered by the same thing: the
refusal has to name the decline as plainly as it names the field, and never
imply that a value would be better than a decline. Everything in the response
above is written for that.

## The three tickets

- **B531** — the contract: `tracks:`, `without:`, the refusal, publish's
  second gate, the registry.
- **B532** — the readout: a trip that has a budget and no day-level spending
  can say so, on `GET .../costs` and in `GET .../status`, along with which
  dates between `start` and `end` have no day at all. That is the other half
  of the reporting run's finding: three bookings on 28 June had nowhere to go
  because no day existed for that date, and nothing named the gap.
- **B533** — the guide has a section for a folder of photographs and none for
  *a journal that already exists in the content format, moving to a hosted
  instance*. A field table from frontmatter key to API field is what would
  have made the agent look at `costs:` instead of at its own recollection.

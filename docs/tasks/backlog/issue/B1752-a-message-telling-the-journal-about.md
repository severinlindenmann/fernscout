---
id: B1752
title: A message telling the journal about a day proposes nothing about three times in four
type: ISSUE
priority: high
complexity: medium
area: helper, whatsapp
found: "2026-09-14T20:00:16Z"
---

# B1752 — A message about a day proposes nothing, three times in four

## Why

The channel's core flow. Somebody sends what happened — a place, a date, what
they did — and expects a day. Measured over 84 cases (both doors, German and
English, clean and phone-typed wordings) with `npm run helper:bench`:

```
20/84   24%  day-from-a-note (both)
             proposed none of start_day/draft_words/set_day_words/assemble_day
```

Three quarters of the time nothing is proposed at all. This is what B1744 was
built to find: no test fails, nothing throws, and one person trying it a
couple of times would call it bad luck.

`--show` gives two distinct failures, and they need different fixes.

**One — the message is routed to `trips`, where no day tool exists.**
`start_day` is only in the `days` area (`lib/helper/tools/areas/days.ts:236`),
and `pickArea` sent these to `trips`. Every answer opens with the trips
block's own words, and then offers to make a *new trip*:

> *"waren heut in eger, burg angeschaut war super"*
> → "Du hast noch keinen Tag angefangen. Sollen wir heute in Eger einen neuen
> Tag starten für **Ungarn 2026**? Dann schreib mir noch: welcher Tag ist
> heute für dich — das Datum …"

> *"3.6 eger burg den ganzen tag sehr heiss"*
> → "Möchtest du eine neue Reise beginnen, die am 3. Juni startet?"

A journal with exactly one trip covering that date is offered a second one —
the same family as B1746.

**Two — it is routed to `days`, and then writes words onto a day that does
not exist yet.** It reaches for `set_day_words`/`draft_words`, collects their
refusals, and stops rather than proposing `start_day` first:

> *"schreib mir den 3. juni auf: Eger, burg, sehr heiss"*
> → "Für dieses Datum gibt es in deinem Journal noch keinen Tag … Leg den Tag
> zuerst an, dann kann das darauf. Der Text ist noch zu kurz zum
> Ausarbeiten …"

Two refusals in one answer and no card. The person is told to do the thing the
software is for.

And one piece of plain nonsense, worth its own look: for *"wir sind heute in
Eger gewesen"* it answered *"Eger liegt allerdings nach dem Ende der Reise"* —
a place treated as a date.

## What was already tried, and did not work

A line in `pickAreaSystemPrompt` telling the router that a message about what
happened is `days` whatever else it names: **24% to 26% over the same 84
cases**. Noise. Reverted rather than shipped, and recorded here so nobody
spends the afternoon on it again.

That result is itself the argument for a mechanical fix over a prompt one.

## Work

Take them separately; they are not one bug.

- **The routing half.** Either `start_day` becomes reachable from `trips` as
  well (cheap, and a day is what a trip is *for*), or a message that carries a
  date and a place stops being a routing question at all. Measure whichever
  is tried — the prompt route is already known not to work.
- **The refusal half.** `set_day_words` and `draft_words` refusing "there is
  no day for this date" is correct and should stay. What is missing is that
  the refusal is a dead end: the obvious next move is `start_day` for that
  date, and nothing carries the model there. Consider whether the refusal
  itself should name it, the way `trip_people`'s refusal names what it needs.
- The place-read-as-a-date answer is either a third bug or a symptom; look at
  it once the two above are out of the way.

## Acceptance

- `npm run helper:bench -- --scenario day-from-a-note --jobs 8` reports a
  clear majority, and the improvement is shown against the 24% recorded here
  rather than argued for.
- No scenario in the corpus regresses:
  `npm run helper:bench -- --against docs/benchmarks/helper-behaviour/baseline.json`.

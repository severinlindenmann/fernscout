---
id: B1752
title: A message telling the journal about a day proposes nothing about three times in four
type: ISSUE
priority: high
complexity: medium
area: helper, whatsapp
found: "2026-09-14T20:00:16Z"
started: "2026-09-15T04:59:22Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-15T04:59:22Z"
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

## Corrected by B1754 — the 24% was partly the harness

The measurement above gave the model exactly one turn. If it did not propose
on that turn, the case failed — so *"welches Datum war heute?"*, a fair
question about a message that carries no date, scored the same as inventing a
trip. B1754 added `nudges` (a canned answer to the question) and the same 84
cases read:

```
54/84   64%  ( 24% straight away, 34 after a question)  day-from-a-note
```

So the honest figures are **24% straight away, 64% resolved within two turns,
36% still genuinely failing**. That last third is this ticket. The two failure
modes below were read off transcripts and still stand — a journal with one
matching trip being offered a second one, and words written onto a day that
does not exist — but the headline was unfair and is withdrawn.

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

## What was done, and what it moved

**The dead end is fixed, and it is a real defect.** `lib/helper/tools/run.ts`
answered `agent.tool.noDay` and stopped; it now hands back `start_day`'s own
card for the date the caller already named, with the words they typed riding
along as its `notes` (B969 built that argument for exactly this). Nothing is
written — `start_day` proposes like every other write tool — and it never
invents a date: a call naming none still gets the old sentence.
`test/no-day-offers-to-start-one.test.ts` holds all four of those claims, so
the fix is proven by the suite rather than by a pass rate that moves on its
own.

**It barely moved the number**: 64% to 67% over the same 84 cases, 24% to 26%
proposing without having to ask. Inside the noise. The reason is in the
failure reasons — the remaining cases mostly never call a day tool at all, so
they never reach the path this fixes.

**Making `days` a second hub was tried and is worse.** `start_day` lives only
in `days`, and a turn whose area pick answers `trips` has no day tools; the
obvious removal of that failure is to put both in the floor. Measured:
**67% to 63%, and 26% to 17% straight away**, for ~1,750 extra tokens a turn.
More tools made the choice harder. Reverted, with the numbers written into the
comment above `HUB_AREA` so the next person to have the idea meets the result
first.

That is now three structural attempts on this one ticket — the router's
prompt (24%→26%), a rule about answering one's own question (7/12 vs 9/12 on
B1742), and a wider tool list (67%→63%) — and **none of them moved it.**
Every change that has actually worked this week was deterministic code: the
link a press returns (B1736), the typed press (B1743), this dead end. That
pattern is worth believing now rather than testing a fourth time.

## Where this stands

**Not finished.** A third of the cases still propose nothing, and the two
transcript-backed symptoms in the Why are unchanged: a journal with one
matching trip offered a second one, and a place read as a date. What is ruled
out is the whole class of fix that makes the model choose better by telling it
to, or by handing it more.

What has not been tried, in the order the evidence favours:

1. **Few-shot examples on the day tools.** The one prompt-side lever with real
   evidence behind it, and no tool in this registry carries an example today.
2. **A bigger model on this turn.** Model choice moves tool-calling accuracy
   more than any prompt or schema change; `HELPER_MODEL` is Haiku 4.5 for
   cost. Worth pricing on this scenario alone.
3. **Removing the choice.** A message carrying a date and a place, on a
   journal with exactly one trip covering it, is not really an ambiguous
   request. A deterministic pre-step — not a model — could resolve the trip
   and the date before any tool is chosen.

## Acceptance

- `npm run helper:bench -- --scenario day-from-a-note --jobs 8` improves on
  **both** figures recorded above — 24% straight away and 64% resolved — and
  the improvement is shown rather than argued for. Straight away is the one
  that matters: a question is friction, not a pass.
- No scenario in the corpus regresses:
  `npm run helper:bench -- --against docs/benchmarks/helper-behaviour/baseline.json`.

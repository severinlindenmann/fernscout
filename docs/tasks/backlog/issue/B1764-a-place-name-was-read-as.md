---
id: B1764
title: A place name was read as a date and reported as being after the end of the trip
type: ISSUE
priority: low
complexity: low
area: helper
found: "2026-09-15T05:34:24Z"
---

# B1764 — A place name was read as a date

## Why

Seen in a bench transcript on the WhatsApp door. Said:

> *"wir sind heute in Eger gewesen"*

Answered:

> "Du hast die Reise **Ungarn 2026** von Juni bis Mitte Juni. Es gibt noch
> keine angefangenen Tage… **Eger liegt allerdings nach dem Ende der Reise.**
> Soll ich eine neue Reise vorschlagen, die heute anfängt?"

Eger is a town in Hungary. It is not after anything. The answer then builds on
its own error and offers a second trip.

Noted while working B1752 and deliberately left there rather than folded into
it: that ticket is about a flow proposing nothing, and this is a single answer
containing a false statement about the person's own journey, which is a
different kind of wrong and the kind AGENTS.md cares most about.

## Work

- Find out whether this is a stray or a shape. One transcript is not a
  pattern; `npm run helper:bench -- --scenario day-from-a-note --show` prints
  the answers behind every failure and is where to look first.
- If it recurs, the question is what the model is being handed about dates and
  ranges. None of the honesty guards in `lib/helper/model.ts` covers a false
  claim about *when* something was — they cover claims about what was saved,
  read, published or counted.

## Acceptance

- Either a filed pattern with several transcripts and a guard, or a note
  saying it was looked for and not found again. Both are acceptable answers;
  leaving it unlooked-at is not.

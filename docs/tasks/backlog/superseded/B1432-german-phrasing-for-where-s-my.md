---
id: B1432
title: German phrasing for “where's my stuff” still routes to the bytes-only account tool
superseded: "B1053. The mis-routing was measured again on 2026-09-11 against the two-pass area router and did not reproduce -- no bytes-only answer in three German probes, and two of the three routed exactly right."
type: ISSUE
priority: low
complexity: low
area: agent
found: "2026-09-11T09:02:56Z"
---

# B1432 — German phrasing for “where's my stuff” still routes to the bytes-only account tool

## Why

B1038 retested B829's two English sentences ("wheres my stuff", "put my
photos up") against the live model under the post-B900 tool-calling router
and found both correctly routed to an inbox-listing tool, naming files and
asking a clarifying question. As part of the same retest, idiomatic German
and Hungarian equivalents were also sent, in a fresh `/agent` conversation
each, against the live instance's `example` journal (owner cookie, real
model, 2026-09-11).

The Hungarian equivalent ("Hol vannak már a cuccaim?") also routed correctly
to the inbox list. The German equivalent — "Wo ist eigentlich mein ganzer
Kram?", a natural, idiomatic way to ask the same question — instead called
the `account` tool and answered in bytes only, exactly the B829 failure
mode:

> Du nutzt etwa 426 MB von deinen 15 GB. Das ist vor allem deine Fotos und
> die fertig gestalteten Fotobücher und Postkartenseiten. Wenn du Platz
> brauchst, kannst du alte PDF-Layouts löschen — deine Tage und alle Fotos
> bleiben erhalten. Brauchst du mehr Speicher, oder suchst du nach etwas
> Bestimmtem in deinen Reisen?

This is a real journal's actual inbox (seven photographs, one CSV) it never
mentioned, because it never called the inbox tool. The English and Hungarian
phrasings of the same question got the useful answer; this one German
phrasing did not — a single run, so it may be non-determinism in the
model's tool choice rather than something specific to German, but it is
exactly the ambiguity B829 exists to guard against and it reproduces on the
current router.

## Work

Per AGENTS.md's own rule, a description change is not the fix — B829
rewording did not fix any of these when tried before, and every fix since
has been a code guard. Options worth weighing, not decided here:

- Run the same German sentence (and near variants) several more times to
  tell non-determinism from a real per-language bias in tool selection.
- If it reproduces: tighten `account`'s tool description
  (`lib/helper/tools.ts:548`, "Bytes only — never where anything is") so it
  is unambiguous in translation, or restructure so a "where's my stuff"
  intent can't resolve to the bytes-only tool at all — the same shape of fix
  B900 already applied elsewhere.
- Not in scope: retranslating every helper tool description defensively
  without a reproduced miss to fix.

## Acceptance

The same German sentence, run several times against the live model, no
longer answers in bytes only when the inbox has real waiting files — or, if
it is confirmed non-deterministic and rare enough not to be worth a guard,
this ticket is closed `wontDo` by a person with that reasoning recorded.

## Decision, 2026-09-11

**A code guard, not a tool description.** Asked when this was promoted, and
answered against this codebase's own record: rewording a prompt or a
description has never fixed one of these and a guard has fixed all of them
(AGENTS.md says so from B829, which is the failure this ticket reproduces).

That also settles the practical half. B1393 left the tool registry at 7,979 of
8,000 tokens, so "tighten `account`'s description" in the Work section above
has no room to be tightened into — and B1053 is now going to regroup that
registry anyway. Build the guard; leave the descriptions alone.

## Re-measured, 2026-09-11 — the fault does not reproduce

The owner asked for a fresh measurement before any guard was built, because
B1053 replaced the 48-way tool pick with a seven-way area classifier hours after
this ticket was filed. That was the right call: **the failure this ticket
records is gone.**

Three German probes against the live model, owner session, one turn each:

| Asked | Went to | Answered |
| --- | --- | --- |
| *"Wo ist eigentlich mein ganzer Kram?"* | trips | *"Du hast fünf Trips in deinem Journal."* |
| *"Wo sind meine hochgeladenen Fotos?"* | **inbox** | *"Du hast 7 Fotos im Inbox warten — sie sind noch nicht an einem Tag angehängt."* |
| *"Was wartet noch bei mir?"* | **drafts** | both unpublished days, named, dated, with their trip |

**Not one bytes-only answer.** The B829 shape — a confident reply in bytes to a
question about where something is — did not occur in any of the three.

So the Work section's target no longer exists in two senses: `lib/helper/tools.ts:548`
was restructured into `lib/helper/tools/areas/`, and the behaviour it was going
to guard is not there to guard. Building the code guard the owner chose would
have meant guarding against a fault that B1053 had already removed — which is
why re-measuring first was worth two credits.

**One thing left, and it is not this ticket.** The first probe is answered
plausibly rather than well: *"where is all my stuff"* gets the trips list, not
the inbox. That is B1053's design showing through — `trips` is the always-present
hub, so it is what an uncertain area pick falls back to. A fallback that answers
something reasonable is the right failure mode, and it is a very different thing
from answering in bytes. Not captured: there is no evidence anybody was misled,
and a ticket for "the model chose a defensible answer over a better one" is how a
backlog fills with taste.

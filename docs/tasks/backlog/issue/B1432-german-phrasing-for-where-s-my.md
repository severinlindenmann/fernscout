---
id: B1432
title: German phrasing for “where's my stuff” still routes to the bytes-only account tool
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

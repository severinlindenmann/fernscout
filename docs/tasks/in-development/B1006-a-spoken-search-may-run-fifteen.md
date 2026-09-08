---
id: B1006
title: A spoken search may run fifteen minutes and a misheard word has nowhere to go
type: FEATURE
priority: medium
complexity: medium
area: search, speech
found: "2026-09-08T18:00:27Z"
started: "2026-09-08T18:00:46Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T18:00:46Z"
---

# B1006 — A spoken search may run fifteen minutes and a misheard word has nowhere to go

## Why

Two things about speaking a search, asked for together.

**1. The recording has no sensible ceiling here.** `RecordButton` stops itself
at `MAX_SPEECH_SECONDS` — fifteen minutes, which is right for dictating a day
and absurd for a search box. A search is a sentence: ten seconds is more than
anybody needs, and a microphone left open because somebody walked away is
somebody's credits going into silence.

**2. A misheard word has nowhere to go.** Transcription is good and not
perfect, and the search sentence is short — which is the worst case, because
there is no surrounding sentence to correct against. "Der Tag am Gotthard"
comes back as "Der Tag am Kotthard" and the agent, matching honestly, finds
nothing. The person is left staring at an empty result list with no clue that
the *words* were the problem.

The agent is already reading the catalogue of everything this reader may see —
every day, place, trip and page, by name. That is exactly the material needed
to recognise a mishearing: "Kotthard" against a journal that contains
Gotthard is not a guess, it is the nearest real thing. What it must not do is
invent a correction that matches nothing.

## Work

- `RecordButton` takes `maxSeconds`, defaulting to `MAX_SPEECH_SECONDS`. The
  search box passes ten. The wizard passes nothing.
- The search route takes `spoken`, so the model knows the sentence may be a
  transcript rather than something typed, and returns an optional
  `suggestion`: what it thinks was actually said. **Grounded in the catalogue
  it was given** — a correction that names nothing in this journal is not a
  correction, and the prompt says so.
- The box renders it as "Meintest du …?" — one press, which re-asks with the
  corrected sentence. Never applied silently: what somebody said is theirs,
  and a search box that quietly answers a different question is worse than one
  that finds nothing.

## Acceptance

- Speaking for more than ten seconds on the search page stops by itself.
- A route test: a suggestion comes back and is rendered; pressing it searches
  the corrected sentence.
- The wizard's own microphone still runs to fifteen minutes.

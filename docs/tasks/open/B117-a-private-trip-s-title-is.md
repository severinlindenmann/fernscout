---
id: B117
title: A private trip's title is shown to anyone who guesses its id
type: SECURITY
priority: low
complexity: low
area: privacy, trips, auth
found: "2026-09-03"
---

# B117 — A private trip's title is shown to anyone who guesses its id

## Why

Noticed while verifying B47. Requesting a private trip without any credential
returns the sign-in gate, as it should — but the gate names the trip:

```
$ curl -s https://fernscout.ch/xydhd-qa1/trips/b47-control     # no Authorization, no cookie
HTTP 200
<title>B47 control trip · …</title>
<h1>B47 control trip</h1>
```

The trip is `visibility: private`. Body, prose, days, tagline and photographs
are all correctly withheld — this is not a content leak. What escapes is the
**title**, to anyone who can guess a trip id.

There is a real argument for the current behaviour, which is why this is filed
low rather than as a hole: a person following a link to a trip they were on
should be told which trip they are being asked to sign in to. "Sign in to see
*Honeymoon, Kerala*" is kinder, and less phishable, than "sign in to see
something". So the question is not obviously "hide it" — it is that nobody
appears to have decided it on purpose, and a private trip's title can be the
sensitive part. `Divorce trip 2026`, a surname, a place that says who was
there.

The exposure is narrow. Trip ids are not enumerable from outside — a private
trip is absent from `/trips`, the sitemap, the feed and the search index — so
this needs a guessed or leaked id. But ids are human-chosen and guessable by
construction (`alps-2024`, `japan-2027`), and the journal name is public. That
is a small dictionary.

The neighbouring decision is already documented the other way: `AGENTS.md`
says an unrecognised `visibility` value reads as `private`, "a typo must not
publish somebody's trip". The instinct there is that the closed state should
be genuinely closed.

## Work

Decide it, then write the decision down — the answer may well be "keep it".

- If the title stays: say so in the visibility documentation, in the same place
  that explains `private` vs `guest`, so an author choosing a trip id knows the
  id and the title are both semi-public. That is the cheapest fix and it may be
  the right one.
- If it goes: the gate says only that a trip exists here and asks for a sign-in,
  and a person arriving from a buddy or guest link — who already knows which
  trip they were invited to — still gets the title from the invitation rather
  than from the gate.
- Either way, check the `<title>` tag as well as the `<h1>`. A browser tab, a
  link preview and a shared screenshot all carry it, and it is the copy most
  likely to be missed.

Not doing: changing whether the gate 200s rather than 404s. Answering 404 for a
private trip would hide its existence, but it also breaks the invited person's
path and turns a sign-in prompt into a dead end. Existence and title are
separable questions and only the second is asked here.

## Acceptance

- The behaviour is deliberate and written down in the visibility documentation,
  whichever way it is decided.
- If the title is withheld, an anonymous request for a private trip exposes it
  in neither the `<h1>` nor the `<title>`, and a test asserts both.

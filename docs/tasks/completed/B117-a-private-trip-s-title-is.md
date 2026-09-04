---
id: B117
title: A private trip's title is shown to anyone who guesses its id
type: SECURITY
priority: low
complexity: low
area: privacy, trips, auth
found: "2026-09-03"
started: "2026-09-03T19:24:37Z"
merged: "2026-09-03T19:39:12Z"
completed: "2026-09-04T05:34:10Z"
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
something". So the question is not obviously "hide it", and a private trip's
title can be the sensitive part. `Divorce trip 2026`, a surname, a place that
says who was there.

**Correction, made while working on it.** The Why said nobody appears to have
decided this on purpose. That is wrong, and the code says so in two places:
`lib/tripGate.ts` documented the title as "the trip's own title, because the
gate says which trip it is guarding and the browser tab should agree", and
`test/trip-gate-copy.test.tsx` asserted it — "is told which trip it is, so the
tab and the page agree". It was decided; it was decided for the invited reader,
and never weighed against the uninvited one. That makes this a reversal rather
than a gap, and both the comment and the test had to be rewritten rather than
filled in.

**What settled it** is a third thing neither the ticket nor the comment
noticed. The gate has three states, and the title appears in exactly one of
them. A reader who signs in and is *still* refused — a journal guest opening a
`private` trip, or anybody signed in with the wrong address — gets
`gate.refusedTitle`, "This trip is not shared with you", and is never told
which trip. So the site was naming the trip only to the reader who had proved
nothing at all, and withholding it from the one who had proved an address.
Those two cannot both be right, and `visibility` fails closed everywhere else
it is read.

The exposure is narrow. Trip ids are not enumerable from outside — a private
trip is absent from `/trips`, the sitemap, the feed and the search index — so
this needs a guessed or leaked id. But ids are human-chosen and guessable by
construction (`alps-2024`, `japan-2027`), and the journal name is public. That
is a small dictionary.

The neighbouring decision is already documented the other way: `AGENTS.md`
says an unrecognised `visibility` value reads as `private`, "a typo must not
publish somebody's trip". The instinct there is that the closed state should
be genuinely closed.

## Decision

**The title goes.** The gate names the journal and never the trip, in the
`<h1>` and in the `<title>` alike.

Three reasons, in the order they weighed:

1. The asymmetry above. The title was shown to the anonymous reader and
   withheld from the signed-in-but-refused one, which is backwards whichever
   way the question is answered.
2. Most of the kindness survives. The `<h1>` becomes the **journal's** title,
   which is already public — it is on the landing page, in
   `/documentation.txt` and in `sitemap.xml` — and it is what a reader actually
   needs in order to know whose sign-in form they are looking at, which is the
   anti-phishing argument. What is lost is the trip's name, and somebody who
   was invited already has it: `/[user]/invite/buddy/<token>` renders the trip
   title on the redemption page, and that page takes a token.
3. The `<title>` was the worse half and it is the half that vanishes for free.
   Omitting `title` from `lockedMetadata` lets the journal layout's own
   `title.default` stand, so the tab reads `<journal> — <tagline>`. No new
   string in any language, and the current trip's gate at the bare `/<user>`
   URL already behaved this way — the two gates now agree.

Reversible: restoring the old behaviour is one prop and one metadata field.

## Work

- `lib/tripGate.ts` — `lockedMetadata()` takes no trip and sets no title. Both
  halves matter: a function that is never handed the title cannot be edited
  into leaking it again.
- `components/TripGate.tsx` — the `tripTitle` prop is gone; the anonymous
  heading is `journalTitle`. Same reasoning, structurally.
- Both layouts that mount the gate stop passing it.
- The decision is written into the visibility documentation in both places
  that carry it: the `visibility` section of `AGENTS.md`, and the `visibility`
  bullet of `.claude/skills/add-a-trip/SKILL.md`, which is where an author
  choosing a title is actually reading.

Not doing: changing whether the gate 200s rather than 404s. Answering 404 for a
private trip would hide its existence, but it also breaks the invited person's
path and turns a sign-in prompt into a dead end. Existence and title are
separable questions and only the second is asked here. The documentation says
so explicitly, so the next reader does not mistake this for a claim that a
guessed id reveals nothing.

Also not doing: distinguishing `private` from `guest` at the gate. One rule is
easier to reason about, an unrecognised value has to read as the closed one,
and a `guest` trip is no more the anonymous reader's business than a private
one.

## Acceptance

- The behaviour is deliberate and written down in the visibility documentation,
  whichever way it is decided.
- If the title is withheld, an anonymous request for a private trip exposes it
  in neither the `<h1>` nor the `<title>`, and a test asserts both.

---
id: B975
title: Voice search stops the instant it starts, and says nothing about why
type: ISSUE
priority: high
complexity: low
area: search
found: "2026-09-08T16:04:06Z"
---

# B975 — Voice search stops the instant it starts, and says nothing about why

## Why

Reported: pressing "Turn on the microphone" on `/<user>/search` turns the
microphone straight back off. Nothing is said, nothing is heard, and the
button returns to its resting state.

`components/SearchBox.tsx` has two faults that each produce exactly that, and
one of them makes the other invisible:

1. **The error is swallowed.** `r.onerror = () => setVoice("off")` — the
   handler takes no argument and reports nothing. Every one of the Web Speech
   API's failures (`not-allowed`, `service-not-allowed`, `network`,
   `audio-capture`, `language-not-supported`, `no-speech`) therefore looks
   identical from the outside: the panel closes and the page carries on. There
   is no way to tell a blocked microphone from a browser with no speech
   service, which is the difference between "allow it in the address bar" and
   "this will never work in this browser".

2. **The language is a bare code.** `r.lang = locale` puts `de`, `en` or `hu`
   on the recogniser. The API wants a BCP-47 tag — `de-DE`, `en-US` — and a
   browser that will not resolve a bare one fails with
   `language-not-supported`, which is to say: instantly, and silently, per
   fault 1.

A third thing makes it worse in ordinary use even when it does work:
`continuous: false` ends the session at the first pause, so a person who takes
a breath before speaking gets `no-speech` and the same silent shutdown.

## Work

- Map the journal's locale to a full tag before handing it to the recogniser,
  and keep the mapping in one place.
- Take the event in `onerror`, and say what happened in the reader's own
  language: blocked, no speech heard, no speech service, or an unexpected
  code — naming the code, because a person reporting this is the only
  diagnostic channel there is.
- `continuous: true`, so a pause is a pause rather than the end.
- Not doing: a fallback to the server's own transcription route. That is the
  owner's, it spends their credits and it hands audio to a provider — none of
  which belongs behind a search box a stranger uses (B890's reasoning stands).

## Acceptance

- With the microphone blocked in the browser's site settings, pressing the
  button says so rather than closing silently.
- On a German journal the recogniser is started with `de-DE`.
- A pause before speaking does not end the session.

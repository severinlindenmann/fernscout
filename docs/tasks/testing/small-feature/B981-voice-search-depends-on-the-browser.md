---
id: B981
title: Voice search depends on the browser's own speech service, which the owner's browser does not have
type: FEATURE
priority: high
complexity: low
area: search
found: "2026-09-08T16:17:04Z"
started: "2026-09-08T16:17:58Z"
merged: "2026-09-08T16:24:25Z"
---

# B981 — Voice search depends on the browser's own speech service, which the owner's browser does not have

## Why

Reported from the owner's own browser: pressing the microphone on
`/<user>/search` says *"Dieser Browser erreicht keinen
Spracherkennungsdienst"*. That message is B975's and it is telling the truth —
the Web Speech API needs a speech service the browser reaches itself, and
several browsers (Brave, some Chromium builds, older Safari) have none. On
those, dictation in search cannot work at all.

Meanwhile this instance already has a transcriber: `POST
/api/helper/<user>/transcribe`, Deepgram behind it, B686. B890 deliberately
did not use it — a search box a stranger types into must not spend the owner's
credits or hand a stranger's voice to a provider — and that reasoning stands
for a stranger. It does not stand for **the owner**, who is the person
reporting this, whose credits they are, and who has an agent search (B904)
sitting beside the box already.

So the two halves belong together: for the owner, speaking is not a way to
fill the search field, it is a way to **ask the agent**. A sentence somebody
says out loud — "the day we got lost near the border" — is exactly the sentence
MiniSearch cannot answer and B904 can.

## Work

- The owner of a journal with `transcription` on gets `components/RecordButton.tsx`
  — the control B686 already built, with its own consent, its own price on it,
  its own language choice and its own error handling. Nothing about recording
  is written twice.
- What comes back does not land in the box and wait: it fills the box **and
  goes straight to the agent** (`POST /api/helper/<user>/search`), because
  that is what a spoken sentence is for.
- The button says so — the agent's mark beside the microphone, and the price
  beside that.
- Everybody else keeps the browser's own dictation, which is free and fills
  the box for the local search. Where the browser has no speech service they
  keep B975's message, which is now the honest answer for a reader who is not
  the owner.

## Acceptance

- As owner, with `transcription` on: speaking a sentence with none of a day's
  words in it lands on that day through the agent, with no second press.
- As a signed-out reader: unchanged — the browser's mic, filling the box.
- The recording control is `RecordButton`, not a second implementation.

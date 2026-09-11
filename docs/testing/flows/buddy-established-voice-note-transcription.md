# Flow: buddy-established-voice-note-transcription

**Persona:** `buddy-established` (docs/testing/personas/buddy-established.md)
**Interface:** `/agent`
**Capabilities exercised:** `transcription`, `helper`, `credits`
**Device/locale:** run at both desktop and mobile viewports when a ticket
asks for both — recording a voice note is a mobile-first gesture and is worth
checking there specifically.
**Check type:** technical (the audio never touches disk, the transcript is
metered, consent was asked) and graphical (the recording control and the
resulting draft text in the `/agent` conversation UI).

## Setup

1. Local dev server running with `features.transcription` on
   (`backend: "dry-run"` — no Deepgram account needed, matching AGENTS.md;
   `dry-run` returns a canned transcript rather than failing), `features.helper`
   on, and `features.credits` on (`transcription`'s own dependency in
   `lib/capabilities.ts`: "speech on top of a credits that is off is not
   cheaper speech, it is unmetered speech billed to the operator").
2. A `test-buddy-established` journal seeded with one trip and a trip-scoped
   agent token for the buddy persona, at a known starting credit balance.
3. Helper speech consent already granted for this persona (`lib/helper/
   consent.ts`'s `speech` scope) — or, if not, the flow's first step is
   granting it, since a recording attempted before consent must be refused.

## Steps

1. Drive `http://localhost:3013/agent` as `buddy-established`. Record a
   short voice note describing only what the persona actually did that day.
2. Confirm `POST /api/helper/test-buddy-established/transcribe` (or
   whichever route this build wires to the recording control) returns the
   dry-run backend's canned transcript, and that the same request without
   speech consent granted is refused before it ever reaches the provider.
3. Confirm no audio file exists anywhere under `contentRoot()` or
   `dataDir()` after the call completes — the route's own comment: "nothing
   is written to disk, at any point... a saved copy of somebody's voice is a
   thing nobody agreed to."
4. Confirm the credit balance decreased by the metered amount for the
   audio's length, and that a balance too low to cover it refuses the whole
   call rather than transcribing for free.
5. Confirm the transcript lands in the draft only after the persona keeps
   it — never written to the day silently — and that the resulting draft
   contains only what the recording actually said (AGENTS.md's own rule
   applies here exactly as it does to typed input: no invented detail from
   an unclear word).
6. Screenshot the recording control and the resulting draft text at the
   requested viewport(s).

## Done when

- The dry-run backend returns its canned transcript with no real Deepgram
  account configured (technical check).
- No audio is ever written to disk, before or after the call (technical
  check — grep the checkout's own data directories for a new file).
- The transcription is metered against the journal's credit balance exactly
  once per recording, and a call with `features.credits` off — or a balance
  too low — is refused (technical check, matching `transcription`'s own
  `needs: { credits: … }` dependency).
- A recording attempted with no speech consent granted is refused before any
  audio is sent anywhere (technical check).
- The recording control and the transcript both render correctly in the
  `/agent` conversation at the requested viewport(s) (graphical check).

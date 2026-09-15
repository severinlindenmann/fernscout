---
id: B1803
title: The import talks about photographs the person cannot see
type: FEATURE
priority: high
complexity: high
area: extract, design, photos, voice
found: "2026-09-15T15:18:04Z"
started: "2026-09-15T15:33:09Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-15T15:33:09Z"
---

# B1803 — The import talks about photographs the person cannot see

## Why

The camera-roll import works. Every route is gated, every rule is tested, a
security pass over the branch came back clean. And using it is a poor
experience, which is a separate fact and the one that matters to whoever opens
it.

**The plan behind it specified behaviour and never specified experience.**
Sixteen task briefs said what each route answers, what each test asserts, which
token each colour comes from. Not one said what a screen *shows*. Sixteen
implementers each built the minimum that satisfied their brief — correctly — and
the sum is sixteen minimal answers where the design was one composed thing.

The sharpest instance, and the reason this ticket exists: **no route serves a
staged photograph.** The security review noted approvingly that "no new route
serves staging bytes/thumbnails over HTTP", and that was read as a win. It is
the missing feature. The premise of this flow is *look at your photographs and
tell me about them*, and there is nothing to look at. All twelve screens in the
design carry thumbnails. The app has none, anywhere.

So somebody is asked "It's Tuesday morning in Hoi An and you took twelve
photographs — what were you doing?" while looking at a wall of text. The
question is good and unanswerable without the pictures.

Beyond that: no step indicator, no selection state, no waveform, no viewer, and
two whole screens missing — "Check the wording" and "Who came".

## Work

`docs/superpowers/plans/2026-09-15-the-import-you-can-see.md`, which carries a
per-screen specification for all twelve screens, extracted from the design file
rather than recalled from it. The design itself travels with the plan this time
(`.superpowers/sdd/b1803/design-v2.html`) — the previous plan named it as its
spec and then described it in prose, on a false assumption that a subagent could
not reach it. That assumption is the root cause of everything here.

Four phases, in dependency order:

1. **The spine** — a thumbnail route for staged photographs (the existing
   `inbox/[id]/thumbnail` route is the precedent and its guards are already
   reasoned out), one tile, one strip, a viewer, and photographs onto all six
   screens that discuss them.
2. **Flow chrome** — the step indicator, the selection ring, icons, and the
   design's own button labels.
3. **The seven thin screens**, including the two that do not exist.
4. **Voice** — asking which language before recording. `SPEECH_LANGUAGES` is
   already `["en", "de", "de-CH", "hu"]` and the transcribe route already takes
   an explicit override; the UI simply never asks.

Out of scope, deliberately: drawing figures from a photograph, and guided flows
for GPS, contacts and statements.

## Acceptance

- Every screen that mentions photographs shows them, and tapping one opens it
  large enough to tell two similar photographs apart.
- The two missing screens exist.
- A person can choose their recording language, and it survives a resume.
- Verified in a browser at 390px in dark **with real content on screen** — two
  bugs in this feature were missed by photographing an empty state.

## Related

Follows B1751, B1797, B1798, B1799, B1802 — each of which fixed a symptom of the
same root cause.

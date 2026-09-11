---
id: B1076
title: Voice recordings are sent to Deepgram without opting out of its model-training programme
type: SECURITY
priority: high
complexity: low
area: transcription, deepgram, privacy
found: "2026-09-09T10:59:14Z"
started: "2026-09-11T04:33:20Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T04:33:20Z"
---

# B1076 — Voice recordings are sent to Deepgram without opting out of its model-training programme

## Why

`lib/helper/transcribe.ts:74-81` builds the Deepgram request with three query
parameters and no others:

```ts
url.searchParams.set("model", DEEPGRAM_MODEL);
url.searchParams.set("language", language);
url.searchParams.set("smart_format", "true");
```

**`mip_opt_out` is not among them.** Deepgram's Model Improvement Partnership
Program is understood to be **opt-out rather than opt-in** — a request that
does not carry `mip_opt_out=true` may have its audio retained and used to
improve Deepgram's models. *(Found by web research, from Deepgram's own
developer documentation on data privacy and a Deepgram GitHub discussion.
**Verify against Deepgram's current terms before writing the ticket's fix
note** — but the fix costs one query parameter either way, so the verification
is about the wording here, not about whether to do it.)*

The reason this is a security ticket and not a chore is the promise the module
opens with, in its own words:

> **Nothing here writes a file.** The bytes arrive in a request, go to a
> provider (or nowhere at all, on `dry-run`), and are dropped with the
> request. Nothing lands under `contentRoot()` or `dataDir()`: a voice
> recording is the most personal thing this product has ever been handed, the
> transcript is the part somebody asked for, and a copy of the audio would be
> a copy nobody remembers agreeing to. `test/helper-transcribe.test.ts`
> asserts the disk is untouched.

That promise is kept, precisely, about **our** disk. It is not kept about
Deepgram's, and the sentence a person reads does not distinguish the two.
Somebody who read that comment — or the consent copy derived from it — would
reasonably believe the recording is gone once the transcript comes back.

**This is live.** `https://fernscout.ch/api/health` on 2026-09-09 reports
`"transcription":{"enabled":true}`, and the `speech` consent scope names
Deepgram to the person before any audio leaves. So every voice note already
recorded through `/agent` went out under these parameters.

## Work

- Add `mip_opt_out=true` to the request. One line, and it is the whole of the
  mechanical fix.
- **Consider the EU endpoint.** Deepgram is reported to offer
  `api.eu.deepgram.com` for EU-only processing. `DEEPGRAM_URL` is a constant
  in this file; making it configurable, or simply pointing at the EU host,
  removes the third-country transfer question for this sub-processor entirely
  for a CH/DE/AT/HU readership. Check it exists and that Nova-3 is served
  there before switching.
- **Request Deepgram's DPA.** Unlike Anthropic's, which is incorporated into
  the commercial terms by reference and is in force on signup, Deepgram's is
  reported to require an email to `security@deepgram.com`. That is an
  operator action, not a code change, and it belongs beside B1063.
- Say the true thing in the module comment and in whatever consent copy
  derives from it: the audio is not written **here**, and the provider is
  asked not to keep it. Two claims, because they are two claims.
- A test asserting the parameter is present. The disk assertion already exists
  and did not cover this; a promise about a provider needs its own.

Not doing: changing the consent flow, or the pricing.

## Acceptance

Every Deepgram request carries `mip_opt_out=true`, a test fails if it stops
doing so, and the comment no longer reads as a promise about the audio's fate
in general when it is a promise about one disk.

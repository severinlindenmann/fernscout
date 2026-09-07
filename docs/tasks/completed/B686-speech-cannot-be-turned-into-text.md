---
id: B686
title: Speech cannot be turned into text
type: FEATURE
priority: low
complexity: medium
area: agent, capabilities
found: "2026-09-07T09:53:00Z"
started: "2026-09-07T12:24:06Z"
merged: "2026-09-07T12:46:50Z"
completed: "2026-09-07T13:13:47Z"
---

# B686 — Speech cannot be turned into text

## Why

Plan §6. The phone is where the traveller is, and talking is faster than typing
on a bus. Speech is also the way to drive the whole product rather than one
field: the ask box (B685) takes a sentence, and a sentence is easier said than
typed.

The provider is **Deepgram**, decided by the owner on 2026-09-07, and the
languages that must work are **English, German, Swiss German and Hungarian**.

## The language decision, which is the whole design

Deepgram's automatic detection (`language=multi`) covers ten languages:
English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian
and Dutch. **Swiss German and Hungarian are not among them**, and both exist as
explicit codes on Nova-3 — `de-CH` and `hu`.

So auto-detection, which is the obvious default, is the one choice that
silently fails two of the four languages this ticket exists for: a Swiss German
speaker would be transcribed as standard German, and a Hungarian speaker would
get nothing usable — with no error, because detection succeeded.

**Take the language from the journal instead.** `content/<user>/config.json`
already carries `locales`, and the request already knows the UI locale. That is
deterministic, costs nothing, needs no detection call, and reaches every code
Nova-3 supports rather than only the ten. Offer an override in the UI for
somebody whose journal is in one language and whose voice is in another, and
remember the last choice.

`de-CH` is worth stating plainly: it is a real Deepgram language code on
Nova-3 and Nova-2 only. Do not fall back to `de` silently if a model is ever
changed — a Swiss German speaker being quietly transcribed as German is the
failure this section exists to prevent.

## Prices, measured 2026-09-07

| | |
| --- | --- |
| Nova-3 monolingual, pre-recorded | $0.0043 / min |
| Nova-3 multilingual (`multi`) | $0.0052 / min |
| New account | $200 free credit |

At one credit per started minute (CHF 0.20) the markup is roughly 45×, which is
the same shape as B684's write-up, so the two are at least consistent. Whether
a minute of speech should cost as much as a whole day written is a product
question for the owner, not a decision for this ticket. Charge one credit per
started minute unless told otherwise, and keep the number in one place.

## Work

- A `transcription` capability, off by default, requiring `DEEPGRAM_API_KEY`,
  a database and `credits` — the same shape `helper` takes in
  `lib/capabilities.ts`, including refusing to come on while `credits` is off.
- A **`dry-run` backend that returns a canned transcript**, so the whole flow
  develops and tests with no account anywhere. That is not a nicety: AGENTS.md
  says no feature may need a paid account to develop or test.
- One real backend: Deepgram pre-recorded, Nova-3, `language` passed
  explicitly. The backend choice is config, the key is environment only.
- `POST /api/helper/[user]/transcribe`, cookie only, bearer refused, the gate
  order B684 established — owner, capability, rate limit, consent, idempotency,
  spend, refund on failure.
- **Consent needs a third scope.** B687 split it into `words` and `photos` so
  that agreeing to one is not agreeing to the other. Audio is a third thing and
  a bigger one — it is the person's voice, and it names a second provider. Add
  `speech`, and re-ask rather than reusing either.
- **The audio is transcribed and discarded.** Nothing is written under
  `contentRoot()` or `dataDir()`. The transcript goes into the draft; the
  recording never lands anywhere.
- The record button belongs in the wizard's words step and in the ask box, so
  one mechanism serves both.

## Acceptance

With the backend on `dry-run`, holding the button produces the canned transcript
and charges nothing a test cannot assert. With a real key, a sentence spoken in
Swiss German is transcribed as Swiss German — not as German — because the
journal's locale said so, and a Hungarian journal gets Hungarian. No audio file
exists on disk afterwards, and the ledger shows the minutes.

## Verified against the real Deepgram API, 2026-09-07

Run from a scratch worktree with `transcription.backend: "deepgram"` and a real
key, signed in as the demo journal's owner. Audio was synthesised with macOS
`say` (German, Hungarian, English) because nobody here can record on demand.

**Directly against the provider**, which is what settles the design:

| audio | `language=` | conf | transcript |
| --- | --- | --- | --- |
| Hungarian | `hu` | 0.98 | "Ma reggel felsétáltunk a várhoz. Meredeket volt, mind gondoltuk." |
| Hungarian | `multi` (auto-detect) | 0.67 | "Moragger versieht alt un cavarhos, m'erede que volt, mint gondoltuk." |
| German | `de` / `de-CH` | 1.00 | "Wir sind heute Morgen zur Bord hinaufgelaufen…" |
| English | `en` | 1.00 | "We walked up to the castle this morning…" |

Automatic detection turns clean Hungarian into gibberish and returns `200` while
doing it. That is the failure this ticket was written to avoid, now measured
rather than argued.

**Through our own route**, `POST /api/helper/example/transcribe`:

- `de-CH`, `hu` and `en` each transcribed correctly, `spent: 1` each.
- Without consent: `403 consent_required`. Consent for `speech` recorded
  separately from `words`.
- Without credits: `no_credits`, before any provider call.
- No `language` given → the journal's own `defaultLocale` was used (`en`).
- `language: "fr"` → `unsupported_language`, listing the four. Not approximated.
- A `Bearer` token → `not_your_journal`.
- Ledger: three rows, `-1 transcription example/speech/5s` each.
- **No audio anywhere on disk afterwards** — nothing under `content/` or the
  data dir, no `.wav`/`.webm`/`.ogg`/`.m4a` written at all.

**Not proven here, and still open for whoever verifies this:**

- **Swiss German dialect accuracy.** macOS has no `de-CH` voice, so `de-CH` was
  sent standard-German audio. It proves the code is accepted and passed
  through; it does not prove Deepgram transcribes Schwyzerdütsch well. That
  needs a real Swiss German speaker, on the deployed instance.
- **Real phone audio.** Synthesised speech is clean studio audio with no
  background noise and flatters any recogniser. A bus, a wind, a restaurant is
  the real test.
- The record button itself at 390px — `MediaRecorder`, hold-to-talk, the
  language select — was never driven in a browser.

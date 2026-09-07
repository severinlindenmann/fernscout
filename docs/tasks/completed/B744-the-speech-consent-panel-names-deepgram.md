---
id: B744
title: The speech consent panel names Deepgram even on a dry-run instance
type: ISSUE
priority: low
complexity: low
area: agent, i18n
found: "2026-09-07T12:46:57Z"
started: "2026-09-07T12:55:04Z"
completed: "2026-09-07T13:35:44Z"
---

# B744 — The speech consent panel names Deepgram even on a dry-run instance

## Why

`agent.speechConsent` names Deepgram in the panel, even on an instance running
the `dry-run` backend, where the recording goes nowhere and no third party
hears anything.

Same shape as B492's dry-run note for the print providers: the panel has no way
to read `speechProvider()` today, so it says the alarming thing unconditionally.
Telling a self-hoster their voice goes to a company it does not go to is a small
lie in the direction of caution, which is the better direction — and still a
lie.

## Acceptance

The panel names the provider actually configured, and says plainly when nothing
leaves the instance.

## What changed

`RecordButton` (`components/RecordButton.tsx`) now takes a required `provider`
prop instead of hard-coding "Deepgram" into the locale string. It is threaded
down from the server, since `speechProvider()` (`lib/helper/transcribe.ts:45`)
reads `site/config.json` and is `server-only` — the client component cannot
call it itself:

- `app/agent/page.tsx` → `AgentDoor` → `HelperAsk` → `RecordButton`
  (`AgentJournal.speechProvider`, `HelperAsk`'s `speechProvider` prop).
- `app/agent/[user]/page.tsx` → `AgentWizard` → `RecordButton`
  (`HelperState.speechProvider`).

Both server pages compute it once with `speechProvider()` and pass it down;
nothing calls the transcriber's config from a client component.

`agent.speechConsent` (`site/locales/{en,de,hu}.json`) now interpolates
`{provider}` where it said "Deepgram" outright. Since `speechProvider()` only
ever returns `"Deepgram"` or `"dry-run"`, and the dry-run case is routed to a
separate string (below), `{provider}` in the real string is always
`"Deepgram"` — the Hungarian string's hand-picked vowel-harmony suffix
("`{provider}hoz`") stays correct for that one value, per the `{name}`
interpolation warning in `lib/i18n.ts`.

**Dry-run gets its own string**, `agent.speechConsentDryRun` (new
`TranslationKey` in `lib/i18n.ts`, added to all three locale files), rather
than a provider name of "dry-run" spliced into the sentence about a named
third party — the ticket's "says plainly when nothing leaves the instance"
needed different wording, not just a different noun. `RecordButton` picks
between the two based on `provider === "dry-run"`.

## Test

`test/record-button-consent.test.tsx` — jsdom + `createRoot`, the same harness
`test/tel-field-combobox.test.tsx` uses rather than adding a testing-library
dependency for one component. Renders `RecordButton`, dispatches a
`pointerdown` on the record button (no prior consent, so this opens the
consent panel), and asserts on the rendered text: passing `provider="Deepgram"`
shows "Deepgram" and not the dry-run sentence; passing `provider="dry-run"`
shows "nothing leaves this server" and never the word "Deepgram". Fails before
this change (there was no `provider` prop to pass, and the string always said
"Deepgram" regardless), passes after.

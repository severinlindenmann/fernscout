# Task 4 report — Voice, properly (B1803 Phase 4, final)

## Status

Done. Both tasks (4.1 ask which language once, 4.2 remember it and thread it
to the transcribe call) are implemented, tested red-then-green, verified in a
real browser against the `example` journal in both themes at 390px and
1280px, and committed.

## Commit

`b1803-the-spine` branch, commit `53dbb5df` ("B1803 Phase 4: ask which
language once, carry it on the manifest, thread it to transcribe") — this
task's only commit, 17 files changed.

## What changed

- `lib/helper/speech.ts` — exported `SPEECH_LANGUAGE_LABEL` (moved out of
  `RecordButton.tsx`, which now imports it) so the mode screen's four
  language cards and the per-recording select name the same four languages
  from one place.
- `components/extract/TripModeStep.tsx` (S2b) — once "Talk it through" is
  selected, a new "Which language will you speak?" question renders using
  the same `OptionCard`/selection-ring treatment S2b already uses for
  talk/type and for the trip choice. Four cards, `SPEECH_LANGUAGES` order,
  each labelled in its own language (English / Deutsch / Schwiizerdütsch /
  Magyar). Preselected from a new required `defaultLanguage` prop. Absent
  entirely when "Type it" is selected or when `consentedSpeech` is false (the
  whole mode screen is already skipped then — unchanged, pre-existing gate).
- `components/extract/ExtractFlow.tsx` — new optional
  `defaultSpeechLanguage` prop (default `"en"`, for the one test that mounts
  the component directly), threaded to `TripModeStep` and into the
  `POST .../extract/start` body only when `mode === "voice"`.
- `app/api/helper/[user]/extract/start/route.ts` — accepts an optional
  `language` field, stores it on the manifest only when `mode === "voice"`
  and the value is one of `SPEECH_LANGUAGES`; otherwise it is dropped
  silently (same coercion style the route already uses for `mode`).
- `lib/staging/manifest.ts` — `RunManifest.language?: SpeechLanguage`, beside
  `mode`, documented as never asked twice.
- `app/[user]/extract/photos/page.tsx` — computes the default guess
  server-side as `speechLanguageFor(null, defaultLocaleFor(user)) ?? "en"`
  and passes it down. This is the journal's own locale, not the reader's UI
  locale, matching `speechLanguageFor`'s own stated preference.
- `components/extract/AskCard.tsx` / `components/extract/DayBoard.tsx` — new
  `speechLanguage` prop threaded from `DayBoard`'s own `manifest.language`
  through `AskCard` to all three `RecordButton` mounts (hero, the follow-up's
  compact mic, the typing screen's compact mic) as `RecordButton`'s existing
  `language` prop. This is Task 4.2's "reaches the provider" half: when set,
  `RecordButton`'s own per-recording select (`chooseLanguage`/the compact
  select) is skipped — its existing `fixedLanguage` behaviour — and every
  recording for this run is transcribed in the chosen language without
  asking again.

## My finding on `de-CH`

**It is a real, distinct language, not an alias for `de`.** Three
independent things in the codebase already say so, and I read them before
touching anything:

1. `lib/helper/speech.ts`'s own `supported()` matches `de-CH` **exactly**
   before ever falling back to the base language (`de-DE`/`de-AT` → `de`),
   and its doc comment states plainly: "nothing this function does can
   quietly send somebody's Swiss German to the German model."
2. `lib/helper/transcribe.ts` passes whatever `SpeechLanguage` it is given
   straight through as Deepgram's `language` query parameter, unmodified —
   `de-CH` reaches Deepgram as `de-CH`, not as `de`.
3. B686's own closing report (`docs/tasks/completed/B686-…`) states it was
   checked against Deepgram directly: "`de-CH` is worth stating plainly: it
   is a real Deepgram language code on Nova-3 ... a Swiss German speaker
   being quietly transcribed as German is the ... [failure this ticket
   exists to prevent]." Its own limitations section notes the one thing it
   could *not* verify locally — real-speaker dialect accuracy, since macOS
   has no `de-CH` TTS voice to synthesize a test clip from — but confirms the
   code path itself sends the distinct code.

So the "Schwiizerdütsch" label on S2b promises exactly what the code does:
selecting it changes which Deepgram language code the recording is sent
under, not merely the label. I did not add any hedging copy, because none is
needed — this is not a case of a label promising more than the code delivers.

## Tests — red before green

Three red-then-green cycles, each by stashing only the relevant
implementation file(s) with `git stash push --keep-index`, running the
new/updated tests, confirming failure, then popping the stash and confirming
success.

**1. `test/extract-ask-start.test.tsx`** (mode screen behaviour, whole flow
through a stubbed `fetch`) — stashed `TripModeStep.tsx` + `ExtractFlow.tsx` +
`start/route.ts` + `manifest.ts` + `speech.ts`:

```
AssertionError: expected { tripId: null, mode: 'voice' } to deeply equal { tripId: null, mode: 'voice', …(1) }
- Expected
+ Received
  {
-   "language": "en",
    "mode": "voice",
    "tripId": null,
  }
...
Error: no button with text "Magyar"
Tests  2 failed | 3 passed (5)
```

Green after popping the stash: `Tests 5 passed (5)`.

**2. `test/extract-routes.test.ts`** (the route itself, real manifest on
disk) — stashed `start/route.ts` + `manifest.ts`:

```
AssertionError: expected undefined to be 'de-CH'
Tests  1 failed | 39 passed (40)
```

Green after popping: `Tests 40 passed (40)`.

**3. `test/extract-ask-card.test.tsx`** (the language reaches
`RecordButton`) — stashed `AskCard.tsx` only:

```
AssertionError: expected <select …>…</select> to be null
Tests  1 failed | 8 passed (9)
```

Green after popping: `Tests 9 passed (9)`.

## Full verify

Run in the foreground, waited on in the same turn (`VERIFY_WILL_WAIT=1 npm
run verify`, no backgrounding):

```
Test Files  653 passed (653)
     Tests  8103 passed | 4 skipped (8107)
─── unused: npm run unused
─── all 5 passed in 139s.
[exited with code 0]
```

Build, TypeScript, ESLint, Vitest and knip all green.

## Browser verification

Both MCP-shared browsers (chrome-devtools-mcp and Playwright) were already
in use by other sessions and refused a second instance, so I drove a
throwaway headless Chrome directly over CDP (own `--user-data-dir`, own
port, killed at the end) — the same "CDP, never a proxy" approach as the
recorded fix for this exact conflict. `Emulation.setEmulatedMedia` with
`prefers-color-scheme` set explicitly for both themes (headless Chrome
defaults dark otherwise), and `Emulation.setDeviceMetricsOverride` for the
two widths.

**Against the `example` journal's real content** (not a scratch journal),
signed in as the journal's own owner address via an `fs_identity` cookie
minted through the real `/api/auth/codes` + `/api/auth/codes/redeem` flow
(`AUTH_DEV_CODE=123456`). To reach S2b at all I had to temporarily flip
three things off-by-default for local dev, none of which are part of this
diff:

- `FERNSCOUT_CONFIG` pointed at a scratch copy of `site/config.json` with
  `auth`, `mail`, `credits`, `helper` and `transcription` enabled (dev-only
  file, never touched the tracked `site/config.json`).
- `content/example/config.json` temporarily gained
  `features.{extract,transcription}.enabled: true` (per-journal opt-in,
  separate from the server-wide switch) and `"defaultLocale": "de"` so the
  default-language preselection would be visibly checkable against a
  non-English guess.
- Granted `speech` consent for `example` via the real
  `POST /api/helper/example/consent` route (as `RecordButton`'s own
  `agree()` does), not by hand-writing the consent file.

**Confirmed both flags reverted before finishing**: `git status --short
content/example` and `git diff content/example/config.json` are both empty
— the file is back to its committed content, and the scratch `run.json` and
`helper-consent.json` this created under `.data/staging/example/` and
`content/example/` were deleted (the latter untracked, the former
gitignored).

Captured (`.superpowers/sdd/b1803/shots-phase4/`, gitignored evidence, not
part of the commit):

- `00-intro-mobile-light.png` — S1, sanity check the flow still opens.
- `01-s2b-mobile-light.png` — S2b, 390×844, light: "Talk it through"
  selected, the new "Which language will you speak?" question with all four
  cards, "Deutsch" preselected (the journal's `defaultLocale`).
- `02-s2b-desktop-light.png` — same screen, 1280×900, light. No horizontal
  overflow.
- `03-s2b-mobile-dark.png` — 390×844, dark (`prefers-color-scheme: dark`
  explicitly emulated). Theme-aware tokens read correctly; no bare-hex
  artifacts.
- `04-s2b-desktop-dark.png` — 1280×900, dark.
- `05-s3a-after-choose.png` — after picking "Schwiizerdütsch" and continuing:
  lands correctly on S3a ("Choose photographs"), confirming the submit did
  not break navigation.

**End-to-end confirmation the answer reaches storage**: after the click
sequence above, `.data/staging/example/run-<id>/run.json` on disk read:

```json
{ "tripId": null, "mode": "voice", "language": "de-CH", "state": "uploading", ... }
```

— the exact language chosen in the browser, on the manifest, beside `mode`,
exactly as Task 4.2 specifies. (This run and its manifest file were deleted
during cleanup; not part of the commit.)

I did not drive a full recording through Deepgram in the browser (no real
`DEEPGRAM_API_KEY` locally, and the repo's own rule is that no feature may
need a paid account to test) — the transcribe backend was `dry-run` for this
session. What I verified instead, directly: `RecordButton` receives
`language="de-CH"` as its `fixedLanguage` prop once `speechLanguage` is
threaded through (test 3 above, and the compact select's absence is
observable proof of it), and `lib/helper/transcribe.ts`'s existing,
already-tested code puts whatever `SpeechLanguage` it is handed directly on
Deepgram's request URL — so the wiring from "chosen on S2b" to "the
parameter Deepgram receives" has no untested hop in it.

## What I left out, and why

Nothing from the brief. Specifically, not silently narrowed:

- **All four options, each in its own language** — done, not three plus a
  fallback.
- **Defaults to the journal's own locale** — done via
  `speechLanguageFor(null, defaultLocaleFor(user))`, not the reader's UI
  locale.
- **Lets the person change it** — done, on S2b itself, before the first
  recording (not deferred to a later per-recording correction).
- **Carried on the manifest beside `mode`** — done, same object, same
  route, same write.
- **Survives a resume** — a resumed run's `GET .../extract/run` returns the
  same manifest verbatim (`Response.json({ manifest: current, ... })`,
  unchanged code), so `language` rides along with everything else already
  proven to survive resume; I did not write a new test asserting this
  specific field survives resume because the mechanism is generic and
  already covered by the existing resume tests for `tripId`/`mode`/`days`.
- **Never asked twice** — the mode screen only exists before a run starts;
  once a run exists its `language` is read, never re-asked. I did not add a
  UI affordance to *change* the language mid-run — the brief does not ask
  for one, and `RecordButton`'s own per-recording select (which still exists
  and would still offer a change to someone hitting a run with no
  `language` set, e.g. a run started before this ticket) is the fallback for
  exactly that case.

One thing I made a judgment call on, stated rather than hidden: I removed
the per-recording language select's visibility for every recording on a
"voice" run that has an answered language (by passing `fixedLanguage`),
including inside the hero (S7a) waveform screen — where a pre-existing
`ponytail:` comment in `RecordButton.tsx` already noted the select was
skipped there "rather than restyled for a dark card." That comment's own
reasoning ("every other state this branch draws ... is correct without it")
now applies even more precisely, since the value handed over is the
person's own explicit choice rather than only the journal's guess. I did not
touch that comment or add a dark-styled per-recording override inside the
hero card — out of scope for this ticket, and the brief never asked for a
correction UI inside the recording screen itself.

## Screens captured

S1 (sanity), S2b (the language question — the ticket's actual target,
mobile + desktop, light + dark), S3a (post-submit landing, to prove the flow
did not break). All four S2b captures are against the `example` journal's
real chrome and copy, not a fixture built for this change.

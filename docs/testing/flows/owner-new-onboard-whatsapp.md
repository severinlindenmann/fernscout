# Flow: owner-new-onboard-whatsapp

**Persona:** `owner-new` (docs/testing/personas/owner-new.md)
**Interface:** WhatsApp
**Capabilities exercised:** `whatsapp`, `whatsappInbound`
**Device/locale:** run once per requested viewport; WhatsApp has no viewport
of its own, so this flow's "device" parameter only matters at the final
step, checking the resulting draft day in the journal UI.
**Check type:** technical (does the right thing land on disk) and graphical
(does the resulting draft day render correctly once checked in a browser).

## What this flow actually is

A number no journal owns does not land in an existing owner's chat — it
hits `lib/whatsapp/onboarding.ts`'s own wizard (B1363), the same eleven
questions `firstQuestions()` asks anywhere else a stranger signs up. Only
once every question is answered does `createJournal()` run and the number
bind. Even then, the *next* message does not land as a draft on its own:
B1058's disclosure gate needs one "yes" first, and — for a journal with no
trip yet — the model asks to make one (with its own confirm) before it will
start a day (with its own confirm), the same draft-first,
ask-before-writing shape `docs/testing/flows/owner-established-use-agent-helper.md`
already documents for `/agent`. Found running this flow live, 2026-09-11 —
the flow used to assume one text and one photo were enough; they are not,
see B1507.

Every onboarding stage takes a **typed** answer (not just a button tap) —
`saidBy()` reads a plain text reply the same way it reads a button press —
which is what makes the setup phase drivable with `scripts/simulate-webhook.ts`
and small fixtures rather than needing to reproduce Meta's interactive-button
JSON. Confirmations later in the conversation (making a trip, starting a
day, saving words) work the same way: type the button's own label back
(`"Make this trip"`, `"Start this day"`) rather than tapping it — B1302's
own finding, that a typed press must be read the same as a tap.

## Setup

1. Local dev server running with `features.whatsapp.backend` and
   `features.whatsappInbound` on, plus `features.signup`, `features.mail`
   and `features.helper` on (the day-writing half is a real model turn) —
   `onboardingOffered()` in `lib/whatsapp/onboarding.ts` requires signup and
   mail, and falls back to the stranger's dead-end sentence if either is
   off. `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` set to any non-empty
   test values (dry-run needs no real Meta credentials), `ANTHROPIC_API_KEY`
   real (small accepted cost, per the design's Global Constraints).
2. `AUTH_DEV_CODE=123456` — the onboarding wizard mails a real six-digit
   code (`sendSignupCode`) and this flow answers it without reading mail,
   since `generateCode()` honours the override the same as every other
   code path.
3. No journal needs provisioning ahead of time — this flow's whole point is
   that WhatsApp itself creates one. The number `41760000000` (the fixtures'
   own placeholder, and the accepted `DOC_NUMBER` form) must **not** already
   be bound to a journal, or the first message lands in that journal's
   ordinary chat instead of onboarding — and must not have sent any of
   these exact fixtures before: the webhook route dedupes on the message's
   own `id` (`wamid.…`), so a fixture already delivered once is silently
   ignored on a retry against the same database. Use a fresh scratch
   database (`.claude/skills/test-a-feature/SKILL.md` step 2,
   `scripts/setup-test-content.ts`) each time this flow is re-run.

## Steps

**Phase 1 — the onboarding wizard, exactly scripted.** Twelve fixtures,
sent in order — `journalForNumber` finds nothing for `41760000000` yet, so
the first one starts the wizard (a fresh contact's very first message is
never read as an answer, only as the trigger to ask the first question):

```bash
for f in onboarding-00-start onboarding-01-language onboarding-02-email onboarding-03-code \
         onboarding-04-title onboarding-05-username onboarding-06-name \
         onboarding-07-nickname onboarding-08-visibility onboarding-09-readers \
         onboarding-10-currency onboarding-11-acknowledge; do
  npx tsx scripts/simulate-webhook.ts whatsapp "$f" --base-url http://localhost:3013
done
```

1. `onboarding-00-start` — any content; consumed as the trigger, not an
   answer.
2. `onboarding-01-language` (types "en") through `onboarding-10-currency`
   (types "CHF") — the eleven onboarding questions in order. Confirm after
   `onboarding-10-currency` that `createJournal()` ran:
   `content/test-owner-new-wa/config.json` exists, with `owner.email`
   matching the fixture's mailed address and `owner.telProvenMethod`
   `"whatsapp-inbound"`.
3. `onboarding-11-acknowledge` (types "yes") — B1058's disclosure gate.
   Confirm the reply is the ordinary "go ahead, tell me about your day"
   sentence, not the stranger sentence or the consent reminder.

**Phase 2 — telling a day, driven live.** Not a fixed script: exactly like
`/agent`, this is a real conversation and the number of turns depends on
what the model asks back. Reuse `inbound-text`/`inbound-photo`'s own
wording as the persona's message content, but give each a **new** message
id and send it fresh (the shipped fixtures' ids are single-use once a run
has sent them):

4. Describe a day, as the persona actually would — a photo and a moment,
   nothing invented. With no trip yet on this fresh journal, expect the
   model to say so and ask to make one rather than guessing — confirm it
   (`"Make this trip"`, typed back) before it will go further.
5. Describe the day again (or continue from where the trip-creation turn
   left off). Expect a `"Start this day"` proposal — confirm it, then
   confirm whatever write-up proposal follows, the same draft-then-confirm
   shape `owner-established-use-agent-helper.md` already walks through for
   `/agent`.
6. Check `GET /api/v1/test-owner-new-wa/status` for the resulting draft day.

## Done when

- All twelve setup messages are acknowledged with a `200` from the webhook
  route, and the journal exists with the right owner/tel-proof after step 2
  (technical check).
- The disclosure gate holds — no model call happens before `"yes"` is sent,
  confirmed by the absence of any `[helper-cache]` log line between the
  greeting and the acknowledgment (technical check).
- A draft day exists after Phase 2, carrying the persona's words as
  written — no invented weather, meals, or feelings (AGENTS.md's own rule) —
  and the photo attached once a photo message is sent (technical check).
- The draft renders correctly at `/<user>/day/<slug>` once published,
  checked in a browser at the requested viewport (graphical check).

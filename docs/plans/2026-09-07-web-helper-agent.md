# The web helper at `/agent`

*Written 2026-09-07, before the work. Intent as it stood then; not corrected
afterwards — see `docs/README.md` on why `docs/plans/` is the one folder that
is never updated to match what shipped.*

## The problem

There is no editing interface and there will not be one (ROADMAP decision 24).
Writing happens through an agent, and today that means one of two things: you
run Claude Code against `fernscout-helper` on your own machine, or you point
your own agent at `/agent.md` and the REST API. Both are excellent answers for
somebody who already has an agent. Neither is an answer for the person this
software is actually for — somebody on a bus with three hundred photographs on
their phone and no idea what an API key is.

`/agent` is the answer for them: a mobile-first guided helper, hosted by this
instance, that turns "here are some photos and here is what happened" into a
draft day in the owner's own folder.

**It is not a CMS.** It writes drafts through the same API an outside agent
uses, and a person still presses publish. What it adds is a face.

## The shape, in one paragraph

The helper is **a wizard that fills in the fields of a `POST /days` request**,
with an intent router in front of it and a model layer beside it. Everything it
does downstream — trips, media, costs, weather, publish, invites — is a call
that already works and is already documented. Almost nothing in this plan is
new domain logic; the new parts are a client, a router, three model-backed
endpoints, a transcription capability, and a two-phase upload.

## Decisions

Made with the owner on 2026-09-07, in the order they were asked.

| | Decision |
| --- | --- |
| Driving | Wizard rails with a deterministic state machine, model calls at named steps — plus a router box in front of it (see below), which makes it the hybrid rather than the pure wizard |
| v1 scope | Sign in → one day, well. Everything else is phase 2 |
| Money | Metered per action in the existing credits ledger, our provider key, a free grant on signup, every button stating its price before the tap |
| Publishing | The helper writes drafts; publishing is a separate, labelled tap by the owner in the flow. It is a person deciding, which is what the rule has always required |
| Speech | Our own record button and server-side transcription, metered per started minute |
| Photographs | Metadata first with no model call at all; vision only when the person presses "describe these" |
| Provider | A `helper` capability, off by default, `claude-haiku-4-5` through the official SDK. Off means the page still works and shows the bring-your-own-agent door |
| Uploads | Web copy first so the day is usable, full-resolution original follows in the background |
| State | The draft **is** the session. No new session table |
| Onboarding | The helper runs the whole signup itself, wrapping the existing signup API |
| Language | UI from `site/locales/`; the day is written in the language the person spoke or typed, never translated |
| Wiring | Cookie-only routes under `/api/helper/`, reusing `lib/api/*`. Bearer tokens refused |
| Entry point | `/agent`, one door, journal chosen after sign-in |
| Consent | A named one-time consent panel before the first model call, revocable |
| Router cost | Free and rate-limited. Only the action it lands on costs credits |
| Confirmation | Every write is confirmed with its fields visible, however confident the model was |

## What "bring your own agent" means here

Nothing new is built for it. `/documentation.txt`, `/<user>/documentation.txt`,
`/agent.md` and `/openapi.json` already are that door, hosted or self-hosted.
What the helper adds is **visibility**: a panel on `/agent`, present whether the
`helper` capability is on or off, that says what those documents are, and hands
over a copyable prompt — the journal name, the base URL, and a handover
credential (B283) — so a person can paste their situation into any agent and
carry on where the helper left off. That panel is not a fallback. It is the
promise this software is built on, and the helper is the thing that must not
quietly replace it.

## 1. State: the draft is the session

No helper-session table, no wizard position persisted anywhere. The state is
derived on each visit from what is already on disk and in the session:

| Question | Answered by |
| --- | --- |
| Which journal? | the cookie, through `resolveAccess()` |
| Which trip? | the date, against each trip's dates; otherwise a picker |
| Is something unfinished? | `GET /api/v1/<user>/drafts` |
| How far along? | the draft's own fields — photos? prose? coordinates? |
| What still needs uploading? | the browser's IndexedDB queue, keyed by file hash |

Step order is **trip → date → photos → words → preview → publish**, and every
step writes immediately. The draft day is created as soon as trip and date are
known, so a killed tab loses nothing but the upload queue, and resuming works
from another device.

Why this rather than a session table: a wizard position kept beside the draft
it describes is a second copy of the same fact, and a second copy disagrees
with the first within a month — the reason this repository keeps status in the
folder name and nowhere else.

## 2. Deterministic first — the Regelwerk

The rule is that a model is called only where nothing cheaper can answer.
Everything here is computed with **no model call**, mostly from code that
already exists:

| Fact | From |
| --- | --- |
| Date, time span, sequence | EXIF — `lib/ingest/exif.ts` |
| Coordinates | EXIF |
| Place name | reverse geocode through the `addressLookup` capability (`photon`, no key) |
| Weather | `weather: true` in the day, looked up by the server from the archive. **Never** the model — AGENTS.md |
| Which trip a day belongs to | the date, against trip dates |
| Grouping photographs into days | `lib/ingest/cluster.ts` |
| A title to start from | place + weekday, as a prefilled editable field |
| Costs, transport, currency, visibility | pickers over the existing enums, never prose |

Three jobs are left for a model, each of them a button with a price on it:

1. **Words → a day's prose.** What the person said, plus the facts above as
   context it may not exceed.
2. **Photographs → captions**, only when asked.
3. *(phase 2)* **A file → a column mapping.** For a bank statement the model
   returns a mapping; code applies it to every row. One call, not one per row.

Nothing is triggered automatically. Nothing runs on upload.

## 3. The orchestrator

A box at the top of `/agent` — "what would you like to do?" — that takes typed
or spoken input. The discipline that keeps it cheap and safe: **the model
routes; it never executes.**

```
typed or spoken → (transcribe) → route() → { intent, slots, confidence }
                                               ↓
                            code looks the intent up in the registry
                                               ↓
        read-only → answer now    |    write → that wizard step, prefilled, confirmed
```

- **`lib/helper/intents.ts` is a registry** — one row per thing the helper can
  do: the intent name, its slots, and what runs (a wizard step or a
  deterministic function). The list shown to the model is generated from the
  registry, so it cannot drift from what exists. Adding a capability later is
  one row.
- **The model returns a row name and some strings.** It is given no client, no
  tools, and no ability to call anything. Structured output, one request.
- **Slots are prefilled fields, never applied silently.** A wrong guess costs a
  tap to correct.
- **Read-only intents answer immediately** — storage, credits, what is
  unfinished — because those are GETs and there is nothing to confirm.
- **Every write is confirmed with its fields visible**, however confident the
  router was. Publish, postcards and deletion keep their own existing gates
  untouched; deletion still ends in a mailbox, whatever the box was asked.
- **One intent per turn.** "Make a trip and add yesterday" does the trip and
  then asks. The wizard is already the multi-step machine; a model-planned
  sequence would be a second one, wrong in ways nobody can enumerate.
- **`unknown` is a first-class answer** and lands on the menu of buttons rather
  than an apology.
- **Voice goes through the same door**, so the microphone drives the whole
  product rather than one field.
- Routing is **free and rate-limited** (`lib/rateLimit.ts`). At roughly $0.0003
  a turn, metering the front door would cost more in avoidance than it recovers.

With the `helper` capability off, the box is absent and the buttons are the
whole interface. The router is an accelerator over a UI that works without it.

## 4. Server surface

New routes under `app/api/helper/`, **cookie-only, bearer refused** — the same
shape as the postcard send route, which `test/postcard-orders.test.ts` already
guards by asserting nothing under `app/api` imports the sender.

```
POST /api/helper/route            text → { intent, slots }          free, rate-limited
POST /api/helper/write-day        words + facts → prose             1 credit
POST /api/helper/describe-photos  chosen media → captions           1 credit per 10
POST /api/helper/transcribe       audio → text                      1 credit per started minute
POST /api/helper/consent          record or revoke consent          free
GET  /api/helper/prompt           the copyable bring-your-own prompt free
```

They are thin. Everything else the wizard needs — trips, days, media, publish,
storage, credits, invites — goes through the **existing** `/api/v1/…` routes
with the cookie, so there is one implementation of "write a day" and the helper
cannot drift from what an outside agent can do.

These are deliberately outside `/api/v1/`: they are browser-only and are not
part of what a third-party agent may call. `/agent.md` gains a short section
saying so, so nobody reading the contract wonders why the helper appears to
have privileges the API does not describe.

`lib/idempotency.ts` applies to every metered route — a retried `write-day`
must not charge twice.

## 5. The model layer

`lib/helper/`, server-only, one file per job, with the model id and every
prompt in one module:

- **`claude-haiku-4-5`** — 200K context, $1/$5 per MTok. A day-write is roughly
  2k in and 600 out, about **$0.005**, against one credit at CHF 0.20. The
  margin is enormous, which is the right side to be wrong on. The prices in
  this plan are placeholders until measured against real traffic.
- The official SDK (`@anthropic-ai/sdk`), **structured outputs** — the model
  returns `{title, prose, warnings[]}`, never free text that we then parse.
- No streaming, no tools, no agent loop. A wizard step is one request.
- The system prompt carries the rule that matters, the same one AGENTS.md puts
  on every agent: **write only what you were told.** No weather nobody
  mentioned, no meals nobody ate, no feelings nobody expressed; an empty field
  beats a plausible fiction; never translate. Returned prose is always shown
  for review before it lands, which is what makes the rule enforceable rather
  than merely stated.

## 6. Capability, consent, self-hosting

A new capability `helper` in `lib/capabilities.ts`, **off by default**,
requiring `ANTHROPIC_API_KEY`, a database and `credits`. Absent rather than
broken when off: `/agent` still renders the sign-in and the bring-your-own-agent
panel.

A second capability `transcription`, also off by default, with a `dry-run`
backend that returns a canned transcript so the whole flow develops with no
account anywhere — the same promise mail and the print providers already keep.
The real backend speaks the Whisper HTTP shape, so a self-hoster can point at
their own server with no new code. Audio is transcribed and discarded; the
transcript goes into the draft.

**Consent, once per journal, before the first model call**: which provider,
what is sent (your words; your photographs only when you press describe), what
is never sent (`gps/`, your contacts, anybody's address), what it costs, and
that it is not used for training. Stored on the journal, revocable from
`/<user>/me`. It is a `ConfirmPanel` — never `window.confirm` (B633, B668).

`agent` must be added to `reserved` in `site/config.json`. It is not there
today, and a journal called `agent` would collide with the route.

## 7. Uploads

Originals are already kept — `lib/api/media.ts` writes every upload to
`originals/` (or `MEDIA_ORIGINALS_DIR`), which is what the photobook renders
from. Nothing about storage changes. What changes is the transfer:

1. **Web copy first.** The browser downscales to 2000px — the width the
   pipeline already targets — and uploads that. The day is complete and
   readable in seconds on a hotel connection.
2. **Original follows.** The same file at full resolution, uploaded in the
   background against the item created in step 1, landing in `originals/` so
   printing keeps its 300dpi source.

A sequential queue with backoff, per-file progress, and resume across a killed
tab. Files are named by a hash of their bytes in the inbox already, so a
re-picked photograph is recognised rather than duplicated. The storage quota
(`lib/storageQuota.ts`) is checked **before** the queue starts, so nobody
uploads thirty-nine photographs and then meets a wall.

One server change is needed: an upload that attaches an original to an existing
media item. That is the only new capability in the media path.

**Anything that is not a photograph goes to the inbox rather than being
refused.** `lib/inbox.ts` already exists for files that belong to no day yet,
hash-named, reachable by no URL. A person who picks a bank statement or a
Google Timeline export out of their files has handed over something useful, and
refusing it costs the one thing that makes the import family cheap later: the
data is already on disk, so "you dropped a statement in — shall I read it?" is
a screen, not an ingestion pipeline. Deciding this now costs a branch in the
upload step; deciding it later costs a second entry point.

## 8. Rails that must not bend

- Every write is `status: draft`. Publishing is a separate, labelled tap.
- The model never sets weather, never invents a fact, never translates.
- `gps/` is read by nothing here, and no coordinate from it reaches a provider.
- Anything the helper is asked to invent gets `test: true`.
- Addresses and contacts never enter a prompt.
- No `window.confirm`, `alert` or `prompt` anywhere.
- Deleting still answers `202` and finishes in a mailbox.

## 9. Testing

`test/helper-*.test.ts`, with the model stubbed:

- the helper routes refuse a bearer token, and accept an owner cookie;
- a metered call charges once under a retried idempotency key;
- the first model call is refused before consent;
- the capability being off yields the bring-your-own panel, not a 500;
- the state machine resolves a half-finished draft to the right step;
- the intent list the router is shown is generated from the registry;
- the prompt carries the facts it was given (the assertion is on the prompt,
  not on what a model returns).

And `test-in-a-browser` at 390px, which is the only check that matters for
whether this is actually usable.

## 10. Order of work

Each row is one task. The first three carry no model at all, which is
deliberate: the risk in this feature is uploads, resume and mobile layout, not
prose.

| | Task | What ships |
| --- | --- | --- |
| 1 | `/agent` shell — sign-in, journal pick, bring-your-own panel, `agent` reserved | a real page, no model |
| 2 | The wizard, deterministic only — trip, date, photos, typed words, preview, publish | **the whole flow, zero credits** |
| 3 | Two-phase upload and the resumable queue | the hotel-wifi fix |
| 4 | `helper` capability, consent, `write-day`, metering and price labels | the model arrives |
| 5 | The intent router and the registry | the box at the top |
| 6 | `transcription` capability and the record button | speech |
| 7 | `describe-photos` | vision, on demand |
| 8 | Signup and onboarding inside the wizard | new journals |

## 11. Not in this plan

Captured as tasks, built after the day flow is real: editing an existing day,
inviting guests and buddies from the helper, photobooks and postcards,
notifications, importing a bank statement or a GPS export, planning an upcoming
trip, and importing a past trip in bulk. Each is a step in the same wizard and
a row in the same registry — not a new surface.

Also not here: a native app (B674 holds that decision), an editing interface of
any kind, and offline conflict resolution.

# Capabilities

Every optional feature starts off. Switched off, it is absent rather than
broken: its routes answer 404 instead of erroring. `FEATURE_NAMES` in
[`lib/config.ts`](../lib/config.ts) is the complete list, and
[`lib/capabilities.ts`](../lib/capabilities.ts) decides what each one needs. A
running instance explains its own state at `/api/health`.

"Capability" in prose and "feature" in code (`features.*`, `FEATURE_NAMES`)
name the same thing.

## The rules

1. **Switching one on is a promise.** A feature that is on but missing its
   credentials refuses to boot and says why, rather than half-working.
2. **A journal narrows the server's choice, never widens it — and only for
   the few features it has any say over at all.** Most features are decided
   once, by the operator, for the whole instance; a journal's own
   `config.json` cannot touch them (`OPERATOR_ONLY_FEATURES`, below). Of the
   rest: `mail`, `whatsapp` and `whatsappInbound` are channels a journal can
   mute below the server's own default. `extract`, `routeRecording` and
   `mapRelief` work the other way — the server allows them, and a journal must
   opt in before they do anything for that journal.
3. **Reading needs nothing.** With `auth` off, every public page, the search,
   the feed and the sitemap still work, because a public trip never touches a
   database or a session. You lose writing and readers.
4. **No paid account to develop.** Mail can write `.eml` files, and most
   providers have a `dry-run` backend. `helper`, `extract` and `transcription`
   are the exceptions below.

## Server-wide or per journal

A feature in `OPERATOR_ONLY_FEATURES` ([`lib/config.ts`](../lib/config.ts)) is
never a journal's own opt-in — a journal's `features.*` value for it is
ignored, and only the operator's server config decides. Everything else is per
journal, within the limits rule 2 above describes.

<!-- BEGIN:generated-feature-table (scripts/build-capabilities-doc.mts) -->

Generated from `FEATURE_NAMES`, `OPERATOR_ONLY_FEATURES` and `PAID_FEATURES`
in [`lib/config.ts`](../lib/config.ts) and [`lib/capabilities.ts`](../lib/capabilities.ts)
by `npm run docs:capabilities` (`scripts/build-capabilities-doc.mts`) — run it
after adding or reclassifying a feature, rather than editing this table by
hand. `test/capabilities-doc.test.ts` fails if this table has drifted from
what it would generate.

| Feature | Scope | Edition |
| --- | --- | --- |
| `addressLookup` | server-wide | — |
| `analytics` | server-wide | — |
| `applePush` | server-wide | — |
| `auth` | server-wide | — |
| `contacts` | server-wide | — |
| `costs` | server-wide | — |
| `credits` | server-wide | — |
| `extract` | per journal | — |
| `helper` | server-wide | — |
| `iosApp` | server-wide | — |
| `logging` | server-wide | — |
| `mail` | per journal | — |
| `mapRelief` | per journal | — |
| `photobook` | server-wide | hosted edition only |
| `postcards` | server-wide | hosted edition only |
| `push` | server-wide | — |
| `reactions` | server-wide | — |
| `routeRecording` | per journal | — |
| `signup` | server-wide | — |
| `sms` | server-wide | — |
| `smsInbound` | server-wide | — |
| `streetMaps` | server-wide | — |
| `transcription` | server-wide | — |
| `weather` | server-wide | — |
| `whatsapp` | per journal | hosted edition only |
| `whatsappInbound` | per journal | hosted edition only |

<!-- END:generated-feature-table -->

`transcription` and `credits` are listed server-wide because a journal cannot
switch them: `transcription` needs no per-journal opt-in and `credits`, like
`logging`, is never a per-journal question. This does not mean every
server-wide feature is decided the same way — see each one's row below for
what actually turns it on.

## What each one needs

These are the same features the table above classifies; this section says
what makes each one boot and what its absence looks like.

| Feature | Needs | Off means |
| --- | --- | --- |
| `auth` | `SESSION_SECRET` and a database | no agent tokens or sessions, so no writing and no readers at all |
| `signup` | `SESSION_SECRET`, a database, and `mail` for whichever `phoneBackend` it is configured with | nobody can create a journal on the instance |
| `contacts` | `CONTACTS_ENCRYPTION_KEY`, a database and `auth` | no readers, invite links or approval queue |
| `reactions` | — | no reactions on days |
| `costs` | — | no cost pages or totals |
| `weather` | — | a day's `weather: true` is never looked up |
| `addressLookup` | nothing for the default backend (`photon`); `ADDRESS_LOOKUP_API_KEY` for any other backend | no address suggestions in a contact form |
| `analytics` | a database | no visits page |
| `logging` | — (operator only) | no request logging |

### Telling readers

| Feature | Needs | Off means |
| --- | --- | --- |
| `mail` | `file` and `console` transports need nothing; `smtp` needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | nothing is sent |
| `push` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no web-push notifications |
| `applePush` | nothing for the `dry-run` backend (the payload is written under `<dataDir>/apns/`); `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY` for the real `apns` backend | no notification reaches an iPhone |
| `sms` | `dry-run` needs nothing; `twilio` needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | no text messages |
| `smsInbound` | `TWILIO_AUTH_TOKEN` and a database | incoming texts are not read |

### The assistant

| Feature | Needs | Off means |
| --- | --- | --- |
| `helper` | `ANTHROPIC_API_KEY` and a database | no writing assistant |
| `transcription` | a database; `dry-run` needs nothing else, `deepgram` needs `DEEPGRAM_API_KEY` | no dictation |
| `extract` | `SESSION_SECRET`, `auth` and `helper`, and a journal must switch it on for itself | no guided import of photos into draft days from the studio |
| `credits` | a database (operator only) | model calls and sends are never metered |

`extract` is the studio's guided camera-roll photo import; it does not read
bank or card statements. Statement reading (`/studio/statement` and
`POST /api/v2/{user}/statements`) needs no feature flag in v2 at all — it is
reachable whenever a journal's owner is signed in.

With `credits` on, the assistant's calls are metered against a journal's
balance. With it off, the assistant is the operator's own and unmetered.
Buying credits is hosted edition only, through `@paid/credits`; the ledger
(`lib/credits.ts`) and spending from it are open.

### Location

| Feature | Needs | Off means |
| --- | --- | --- |
| `routeRecording` | nothing of its own, and a journal must switch it on for itself | the iPhone app records no GPS history, and the two owner-cookie doors that read it back (a place name for a day, the owner's own recorded route) stay closed |
| `streetMaps` | `MAPS_DIR` with a readable `world.pmtiles` (`npm run maps:world`) | every map is the drawn SVG map; no street tiles anywhere |

Street detail comes from one of two sources, both OpenStreetMap data cut
from a Protomaps build (credited on every map and card):

- **`npm run maps:planet`** puts the whole world at street level in
  `MAPS_DIR/planet.pmtiles` — about 120 GB, resumable, needs the same again
  free while it downloads. Every trip, day and place then has streets with
  nothing else to run. What fernscout.ch uses.
- **`npm run maps:trip -- <user> <trip>`** cuts just one trip's regions
  (tens to hundreds of MB each) — for a small instance without the disk.
  Run by hand; a trip without one shows the drawn map.

Where both exist, a trip's own file wins where it covers the trip's places.

## Hosted edition only

Four features — `photobook`, `postcards`, `whatsapp`, `whatsappInbound` — are
named in `FEATURE_NAMES` so that one configuration file works for both
editions, but their code lives in the private repository (`PAID_FEATURES` in
[`lib/capabilities.ts`](../lib/capabilities.ts)). Switching one on in the open
edition refuses to boot with "features.… is enabled but it is not included in
this build".

| Feature | What it is at fernscout.ch |
| --- | --- |
| `photobook` | a trip laid out and printed as a book |
| `postcards` | real printed cards to readers' addresses |
| `whatsapp` | new-day messages and the guided assistant on WhatsApp |
| `whatsappInbound` | the guided assistant reading WhatsApp messages |

One more feature builds on those but is not itself refused in the open
edition, because it behaves differently when the feature it depends on is
absent:

- `mapRelief` — the shaded relief layer on a photobook's route map. It needs
  `photobook` to be enabled (`REQUIREMENTS` in `lib/capabilities.ts`), so with
  no `photobook` in this build it is simply never reachable; switching it on
  by itself boots fine and does nothing.

# Capabilities

Every optional capability is **off by default**. Switched off, it is absent
rather than broken: its routes answer 404 instead of erroring. `FEATURE_NAMES`
in [`lib/config.ts`](../lib/config.ts) is the complete list, and
[`lib/capabilities.ts`](../lib/capabilities.ts) decides what each one needs.
A running instance explains its own state at `/api/health`.

## The rules

1. **Switching one on is a promise.** A capability that is on but missing its
   credentials refuses to boot and says why, rather than half-working.
2. **A journal can narrow the server, never widen it.** A journal's own
   `config.json` can switch things off for itself, never on.
3. **Reading needs nothing.** With `auth` off, every public page, the search,
   the feed and the sitemap still work, because a public trip never touches a
   database or a session. You lose writing and guests.
4. **No paid account to develop.** Mail can write `.eml` files, and every
   provider has a `dry-run` backend.

## Reading and writing

| Capability | Needs | Off means |
| --- | --- | --- |
| `auth` | `SESSION_SECRET` and a database | no agent tokens, so no writing at all |
| `signup` | `SESSION_SECRET`, a database and mail | nobody can create a journal on the instance |
| `contacts` | `CONTACTS_ENCRYPTION_KEY`, a database and `auth` | no guests, invite links or approval queue |
| `reactions` | — | no reactions on days |
| `costs` | — | no cost pages or totals |
| `weather` | — | a day's `weather: true` is never looked up |
| `addressLookup` | the default backend (`photon`) needs nothing | no address suggestions in a contact form |
| `analytics` | a database | no visits page |
| `logging` | — (operator only) | no request logging |

## Telling readers

| Capability | Needs | Off means |
| --- | --- | --- |
| `mail` | `file` and `console` need nothing; `smtp` needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | nothing is sent |
| `push` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no web-push notifications |
| `sms` | `dry-run` needs nothing; `twilio` needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | no text messages |
| `smsInbound` | `TWILIO_AUTH_TOKEN` and a database | incoming texts are not read |

## The helper

| Capability | Needs | Off means |
| --- | --- | --- |
| `helper` | `ANTHROPIC_API_KEY` and a database | no writing helper |
| `transcription` | a database; `dry-run` needs nothing else, `deepgram` needs `DEEPGRAM_API_KEY` | no dictation |
| `extract` | `SESSION_SECRET`, `auth` and `helper` | no reading statements and photos into draft days |
| `credits` | a database (operator only) | model calls and sends are never metered |

With `credits` on, the helper's calls are metered against a journal's balance.
With it off, the helper is the operator's own and unmetered. Buying credits is
part of the hosted edition, not this repository.

## Location

| Capability | Needs | Off means |
| --- | --- | --- |
| `routeRecording` | — | the iPhone app records no route |

## Hosted edition only

These names appear in `FEATURE_NAMES` so that one configuration file works for
both editions. The code behind them lives in a private repository. Switching
one on in this build stops the boot with "features.… is enabled but it is not
included in this build".

| Capability | What it is at fernscout.ch |
| --- | --- |
| `photobook` | a trip laid out and printed as a book |
| `postcards` | real printed cards to readers' addresses |
| `whatsapp` | new-day messages and the guided helper on WhatsApp |
| `whatsappInbound` | the guided helper reading WhatsApp messages |
| `mapRelief` | the shaded relief layer on a photobook's route map (needs `photobook`) |
| `fulfilmentRelay`, `fulfilmentAccept` | handing print orders between instances |

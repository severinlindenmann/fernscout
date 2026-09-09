---
id: B1057
title: Nothing reads an inbound WhatsApp message, so the number can be written to and never answers
type: FEATURE
priority: high
complexity: high
area: whatsapp, webhook, security
found: "2026-09-09T07:11:41Z"
---

# B1057 — Nothing reads an inbound WhatsApp message, so the number can be written to and never answers

## Why

`lib/whatsapp/` sends and never listens. `cloud.ts` has two calls — upload a
photograph, send an approved template — and `types.ts:1` says why the message
type has no free-form variant: *"outside a 24-hour customer service window the
Cloud API accepts nothing else, and a publish notice is by definition
business-initiated."*

That is a complete and correct description of B365's feature. It is also why
the number this instance owns (+41 78 217 26 46, see B403) can be written to
by anybody and answers nothing. B386 is the wont-do that recorded the harm:
a footer promised *"STOPP zum Abbestellen"* to somebody's family over a
channel where nothing read a reply.

Everything downstream of this ticket — onboarding by chat, photographs from a
phone, a voice note becoming a day — needs one route that does not exist.

## Work

The route, and only the route. Model it on `app/api/webhooks/stripe/route.ts`,
which already solves the same three problems.

- `GET /api/webhooks/whatsapp` for Meta's `hub.challenge` handshake, gated on
  a verify token from the environment.
- `POST` for events. **Verify `X-Hub-Signature-256` over the raw body**, with
  the app secret from the environment — the Stripe route's discipline about
  reading the raw body before anything parses it applies exactly.
- **Idempotency.** Meta retries, and a retried photograph is a second
  photograph. `lib/idempotency.ts` already exists (it was moved out of
  `lib/mcp/` when MCP was removed) and the message `wamid` is the natural key.
- **Answer fast, work after.** Meta expects a prompt 200 and retries what it
  does not get; a model turn plus a tool round is not prompt. The `jobs` table
  exists; a queue per conversation is also what stops five photographs sent in
  four seconds becoming five interleaved model turns.
- Normalise the event into one inbound shape — text, image, audio, document,
  location, contacts, interactive reply — and stop there. What each becomes is
  B1058 through B1060.
- **A dry-run path, as every other provider here has.** AGENTS.md: no feature
  may need a paid account to develop or test. A fixture posted at the route
  must drive the whole chain locally with no Meta account.
- `features.whatsapp` gains an inbound switch, off by default, and
  `/api/health` explains what is missing when it is off.

Not doing: replying (B1056), identifying the sender (B1058), or any media
handling.

## Acceptance

A signed fixture posted to the route is accepted, an unsigned one is refused,
the same fixture posted twice does one thing, and none of it needs a Meta
account.

## Researched — 2026-09-09

From Meta's own developer documentation where it could be read. Meta's docs
are a JavaScript-rendered app and several pages returned only a shell; **every
soft answer below is marked, and the list of things needing a live account is
at the end.** Do not hardcode a user-facing error string from this section
without pulling the live page.

### The handshake and the signature

`GET` carries `hub.mode` (always `subscribe`), `hub.verify_token` and
`hub.challenge`. Check the token, answer **200 with the raw challenge as the
body** — plain text, not JSON-wrapped.

`X-Hub-Signature-256` is `sha256=<hex>`, HMAC-SHA256 of the **raw request body
bytes** under the **app secret** — not the access token, and not per-WABA.
Compare in constant time.

**The raw body has to be captured before anything parses it.** Re-serialising
the parsed object changes whitespace and key order and the signature will not
match. `app/api/webhooks/stripe/route.ts` already solves exactly this and is
the pattern to copy rather than re-derive.

Two environment variables join `WHATSAPP_ACCESS_TOKEN` and
`WHATSAPP_PHONE_NUMBER_ID` in `lib/capabilities.ts`: an app secret and a
verify token. Neither belongs in `site/config.json`.

### Retries, idempotency, size

- Meta retries a non-200 **with decreasing frequency for up to seven days**.
  The backoff schedule is not published.
- Meta states plainly that retries *"can result in duplicate webhook
  notifications"*. The `wamid` in `messages[].id` is stable across a retry —
  dedupe on it. Status webhooks need `statuses[].id` **plus** the status
  value, since the same id legitimately arrives three times.
- **Payload cap is 3 MB.**
- Meta publishes no timeout figure. Answer 200 immediately and work
  afterwards; a slow handler reads as a failure and earns a redundant retry.

### The inbound shapes

Envelope is `entry[].changes[].value` with `messaging_product`, `metadata`
(`display_phone_number`, `phone_number_id`), `contacts[]` and `messages[]`.

**`messages[].from` is the authoritative sender. `contacts[].profile.name` is
self-reported by the sender's own client and is not verified** — it must never
be trusted as a name for anything, which matters for B1074's contact cards.

Per type, the fields that matter here:

- **text** — `text.body`.
- **image / video / document / sticker** — `id`, `mime_type`, `sha256`,
  optional `caption`; `document` also carries `filename`. Stickers never carry
  a caption.
- **audio** — `mime_type: "audio/ogg; codecs=opus"` and **`voice: true`**,
  which is what distinguishes a held-button voice note from an audio file
  somebody forwarded. B1060 should treat them differently.
- **location** — `latitude`, `longitude`, and optionally `name`, `address`,
  `url`. A plain pin carries only the two coordinates. **Live location is not
  a supported inbound type.**
- **contacts** — a top-level array (several cards in one message), each with
  `name`, `phones[]` (each with an optional `wa_id`), `addresses[]`,
  `emails[]`, `org`, `birthday`, `urls[]`. **Every sub-field is optional and
  user-controlled.**
- **interactive** — `interactive.type` is `button_reply` or `list_reply`, each
  carrying `{id, title}` (a list reply also carries `description`).

`context` appears whenever the person replied to a specific message — `{from,
id}`, where `id` is the `wamid` being answered. Interactive replies always
carry it, which is how a press is tied back to the proposal that offered it.
*Whether `context` can also carry `forwarded` / `frequently_forwarded` /
`referred_product` could not be confirmed — Meta's own reference page would
not render. Verify against a live payload.*

### Media: there is a new shortcut, and a five-minute fuse

The documented flow is two calls: `GET /{API_VERSION}/{MEDIA_ID}` with the
bearer token returns a temporary `url`; then `GET` that url **with the same
bearer header** for the bytes.

**The temporary url expires after five minutes.** The media *id* lasts 7 days
when it came from a webhook (30 days when we uploaded it).

**New since 12 November 2025**: inbound media objects now carry a `url` field
directly, rolled out gradually, letting the first call be skipped. It was
present on every example fetched. What is **not** documented: whether that url
has the same five-minute fuse, and whether every account has it yet. **Build
both paths — use `url` when present, fall back to `GET /{media-id}` — and do
not remove the fallback until a live account proves it.**

Confirmed inbound limits and types:

| | Max | MIME |
| --- | --- | --- |
| Image | **5 MB** | `image/jpeg`, `image/png` |
| Video | 16 MB | `video/3gpp`, `video/mp4` |
| Audio | 16 MB | `audio/aac`, `amr`, `mpeg`, `mp4`, `ogg` |
| Document | 100 MB | pdf, txt, doc(x), xls(x), ppt(x) |
| Sticker | 100 KB static / 500 KB animated | `image/webp` |

Note `image/heic` is **not** in that list, though this instance accepts HEIC
elsewhere — WhatsApp converts before sending, so it should not bite, but a
document-sent `.heic` might.

**The photo-versus-document compression claim in the Why section above has no
first-party Meta citation.** It is consistent, widely reported community
knowledge and it drives a design decision, so **confirm it empirically**: send
the same known image both ways and compare what arrives. That is ten minutes
and it settles it.

### Sending: every limit, since the renderer needs them

**Reply buttons** — `interactive.type: "button"`. Max **3** buttons. Button
`title` **20 chars**, `id` 256. `body.text` **1024**. `footer.text` **60**.
Header optional (text, image, video or document).

**List** — `interactive.type: "list"`. Up to **10 sections**, and **10 rows
total across all sections combined** — not ten per section. `action.button`
**20 chars**. Row `title` **24**, row `description` **72**. `header.text`
**60**. `body.text` **4096**. `footer.text` **60**.

**Location request** — `interactive.type: "location_request_message"`,
`action.name` literally `"send_location"`, `body.text` up to 1024. The answer
arrives as an ordinary `location` message. **This is what B1074 should send.**

**CTA URL button** — `interactive.type: "cta_url"`, with
`action.parameters.{display_text, url}`; `display_text` **20 chars**. This is
the natural rendering of the `link` block, and of the four web escapes.

Those numbers belong in the renderer as named constants with this section
cited, not scattered as literals.

### The window, and what is actually free

A message **or a call** from the person opens a 24-hour window, and resets it
each time. Inside, any of the service message types may be sent with no
template. Outside, only approved templates — a free-form send fails with
**error 131047** and the person never receives it.

Since **1 July 2025** billing is **per template message delivered**, not per
conversation. Meta's own words: *"All non-template messages are free."*
Utility templates delivered inside an open window are also free. Service
conversations have been free since November 2024.

**So a bot that only ever replies inside the window is not billed at all.**
That is the mechanism behind B1061's never-initiate rule, and it is now
confirmed rather than assumed.

There is also a **72-hour** free window when the person arrives via a
click-to-WhatsApp ad or a Page CTA. Not relevant here, and worth not
forgetting if an ad is ever run.

*A reported cap of roughly **3 business-initiated conversations per user per
24 hours** could not be confirmed against a first-party page. It would not
bind anything planned, since nothing initiates.*

### Errors worth handling

`131047` window closed · `131026` recipient unreachable (no WhatsApp, or an
old client) · `131056` too many messages to one recipient · `130429` account
throughput limit · `132000` template parameter count mismatch · `132001`
template does not exist in that language — *the error this instance already
saw in B403* · `131051` unsupported message type · `131045` number
registration problem.

**The wording of every one of these is reconstructed, not quoted.** Pull the
live page before putting any of it in front of a person.

### Two things that would surprise a stale mental model

- **The On-Premises API was discontinued on 23 October 2025.** Any guide
  describing its webhook behaviour — notably that it embedded a media URL
  directly — describes a dead product, which is confusing precisely because
  Cloud API is now growing the same field.
- **Conversation-based pricing is gone**, but `pricing.pricing_model` may
  still read `"CBP"` in status webhooks as a legacy field name. Trust
  `billable` and `category`; do not read `pricing_model` as evidence of
  anything.

### Needing a live account before shipping

- Whether the new inbound media `url` is live on this WABA, and its expiry.
- The literal text of error 131047 and its neighbours.
- The full `context` shape.
- Photo-versus-document compression, measured.
- The full `conversation.origin.type` enum, and whether `pricing_model` still
  varies.

## Decided further — 2026-09-09

- **Debounce per conversation.** Four photographs and a sentence in eight
  seconds are five webhooks and must become **one** model turn. Collect for a
  short pause, then answer once — it reads like somebody who waited for you to
  finish, and it costs one credit instead of five. The pause length is a
  constant to pick and to write down.
- **Mark read immediately, and show a typing indicator** while the turn runs.
  A model turn plus tool rounds is ten to twenty seconds and WhatsApp shows
  nothing; without this, people re-send, which is exactly the burst above.
  The indicator lapses and has to be refreshed — that is real machinery and it
  was chosen with that known.
- **Two capability switches, not one.** `features.whatsapp` today means "send
  day announcements to readers". The conversational channel is a different
  capability with a different cost, a different consent story and a different
  audience, and a journal may want one without the other. Conflating them
  means turning off announcements silently kills somebody's writing door.
- **Rate limiting keys on the sender's E.164**, never the IP. `lib/rateLimit.ts`
  is per-IP and in-process, and every webhook arrives from Meta — one IP for
  the whole world. This is the single most important line in the route.
- **The turn stays free.** The reasoning that made `/ask` unmetered on the web
  holds here — roughly a third of a rappen a turn, and metering the front door
  costs more in people not daring to knock than it recovers. What changes is
  the brake, above, not the price.

## Corrected — 2026-09-09

The bullet above reading **"The turn stays free"** is wrong and was overtaken
within the hour. The owner replaced it with a general rule — *any external
call that costs real money is charged to the journal; only our own compute is
free* — which applies to the web room as well as this channel. **B1091** is
that work.

What survives from that bullet is the half that was never about price: the
brake. `lib/rateLimit.ts` is per-IP and every webhook arrives from Meta's
single IP, so the limit here must key on the sender's E.164 regardless of what
a turn costs. A balance is the journal's money, not a defence against somebody
spending it, so both exist.

This route therefore depends on B1091 rather than merely coexisting with it: a
turn arriving by webhook has to spend and refund exactly as the web room's
does, and it must not grow a second copy of that logic.

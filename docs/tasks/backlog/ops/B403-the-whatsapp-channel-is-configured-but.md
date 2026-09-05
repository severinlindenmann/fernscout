---
id: B403
title: The WhatsApp channel is configured but has never delivered a real announcement
type: OPS
priority: high
complexity: medium
area: whatsapp, live instance, templates, cost
found: "2026-09-05T00:40:00Z"
---

# B403 — The WhatsApp channel is configured but has never delivered a real announcement

## Why

B365 shipped, is merged, and is enabled on fernscout.ch. Every part of the
path has been exercised on the live instance **except the last one**: Meta
accepting an approved template. Until that happens the feature is configured
and unproven, and the account state is easy to forget — this file exists so
picking it up again is reading one page rather than re-deriving a night's
work.

**Everything below was verified against the running instance on 2026-09-05,
not assumed.**

## Where it stands

| | |
| --- | --- |
| Business number | **+41 78 217 26 46**, display name "Fernscout", VERIFIED, quality GREEN |
| Phone number id | `1253568101181150` |
| WABA id | `1043886595223059` (currency **EUR**, `account_review_status: APPROVED`) |
| Business verification | **not_verified** — so 250 unique recipients / 24h. Irrelevant at family scale |
| Credentials | `WHATSAPP_ACCESS_TOKEN` (System User, non-expiring) + `WHATSAPP_PHONE_NUMBER_ID` in `/etc/fernscout/env` |
| Server capability | `features.whatsapp` = enabled, backend `cloud`, `defaultCountryCode: "41"` |
| Journal opt-in | `features.whatsapp.enabled: true` for `example` (it is a per-journal opt-in; the server switch alone does nothing) |
| Migration | `015-contact-whatsapp` applied on production Postgres |
| Templates | **`fernscout_day_published_v2`**, de/en/hu, **PENDING** |

**The name is v2 because the v1 name is burnt until early October.** The
first set carried a footer promising "STOPP zum Abbestellen" and nothing in
this codebase reads an inbound message; deleting them to fix that reserved the
name for 30 days. `lib/whatsapp/settings.ts` now carries the rule: never
delete a template to fix it, create the next version under a new name and
repoint the config.

## What is already proven

Driven end to end against fernscout.ch, through the real API, not curl:

- `POST .../days/utah-red-country/send-mail` → `sent: 2, failed: 0`
- `POST .../days/utah-red-country/send-whatsapp` → `sent: 0, failed: 1`,
  error `(#132001) Template name does not exist in the translation`, against
  a **masked** number (`•••••••3150`)

That failure is the *right* failure and proves the whole chain up to Meta:
recipient selection, the trip-visibility gate, `toE164` normalisation,
per-locale template selection, the photo re-encode, and the reporting
contract — counts and a reason, never a phone number. One bad recipient did
not fail the call.

Separately, free-form sends to +41 76 561 31 50 (photo + caption + links, and
a link-preview variant) arrived correctly, which proves media upload and
delivery from the production number.

## Resume here, when a template shows APPROVED

```bash
T=$(cat ~/.fernscout-wa-token)   # or wherever the token lives by then
curl -s "https://graph.facebook.com/v25.0/1043886595223059/message_templates?name=fernscout_day_published_v2&fields=language,status,rejected_reason" \
  -H "Authorization: Bearer $T"
```

Then the real thing. The owner token minted on 2026-09-04 expires
**2026-09-11**; after that, mint another via `POST /api/auth/request` +
`/verify` for `agent@fernscout.ch` on `example`.

```bash
curl -X POST "https://fernscout.ch/api/v1/example/trips/usa-2026/days/utah-red-country/send-whatsapp" \
  -H "Authorization: Bearer <owner token>"
```

Expect `sent: 1`. Then read the actual cost back (see below).

**The test contact is `lindenmann@severin.io` on `example`**, `wants_whatsapp
= 1` with a stored number. It was made `active` **by hand in Postgres** at the
owner's request, which skipped `approveContact` and therefore its access
grant. Harmless today because all five `example` trips are `public`, so
`isOpenToLink` short-circuits the gate — but a `guest` or `private` trip added
to `example` will not reach this contact despite it looking active. Delete the
contact, or approve it properly, when this is done.

## What it costs — measured, not estimated

`GET /{WABA_ID}?fields=pricing_analytics.start(…).end(…).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`
reports real spend for this account:

| Category | Type | Rate observed |
| --- | --- | --- |
| `SERVICE` | `FREE_CUSTOMER_SERVICE` | **€0.00** |
| `UTILITY` | `REGULAR` | **€0.0142 / message** (CH) |
| `MARKETING` | — | **not yet measured** — no marketing template has sent |

Estimate for marketing in Western Europe is 3–6× utility, so €0.04–0.09.
**Replace that guess with the measured number** from the same call once the
first announcement goes out.

At 20 recipients and 10 published days per trip: roughly **€14 as marketing,
€2.84 as utility**. The category is a 5× lever, which makes the reclassify
appeal (below) the highest-value follow-up.

## Decisions already researched, so they need not be re-researched

- **What varies per send.** The header **image is free every time** (verified
  by sending Meta's own sample template with a Fernscout photo). Body
  variables are free text, max 1024 chars for the whole body, and **no
  newlines, tabs or 4+ consecutive spaces inside a parameter** — which is why
  `asParameter` in `dayWhatsapp.ts` flattens whitespace. The fixed scaffolding
  between variables cannot change without a new template.
- **A "wide" template is possible and not built.** A body like
  `Hallo {{1}}, {{2}} — mehr auf fernscout.ch` gives ~1000 characters of
  free text per send, losing only paragraph breaks. Worth adding beside the
  narrow one; `templateFor()` already reads names from config, so it is
  config plus a selector, not a rewrite.
- **Category appeal.** Registered as `MARKETING`, which is the safe call.
  `UTILITY` is ~5× cheaper and exempt from frequency capping. Meta allows an
  appeal within 60 days of approval. Try it once approved; do not gamble the
  launch on it.
- **Frequency capping.** A user receives ~2 marketing template messages per
  day **across all businesses**. Over the cap Meta drops the message with
  `131049` and it is not our fault. Never bites at this cadence; it is why
  "send more" is not a strategy.
- **Groups: researched and rejected.** A Groups API does now exist (2026,
  `recipient_type: "group"`), contradicting the long-standing "no groups"
  answer. It needs an **Official Business Account** — we are `not_verified` —
  and caps at **8 participants per group**, with invite-link-only joining.
  Pricing is per message either way, so a family of twenty means three groups
  for no saving. Revisit only if the business is verified for other reasons.

## Related, not part of this

- **B386** — a WhatsApp recipient still has no working unsubscribe. Blocking
  works but leaves `wants_whatsapp = 1`, so every publish still tries and
  still bills. Highest-priority follow-up.
- **B372** — the header photo is uploaded to Meta even for a `private` trip,
  documented only in a code comment.
- **B369** — WhatsApp sends are not charged against the credits ledger.

## Acceptance

- A template shows `APPROVED` and `POST .../send-whatsapp` returns
  `sent: 1, failed: 0`.
- The message arrives on +41 76 561 31 50 with the photo, the three filled
  variables and a working "Eintrag lesen" button.
- The measured `MARKETING` rate replaces the estimate in this file.
- The hand-approved test contact is deleted or approved properly.

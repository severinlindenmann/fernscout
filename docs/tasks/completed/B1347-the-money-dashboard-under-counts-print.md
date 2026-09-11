---
id: B1347
title: The money dashboard under-counts: print costs are a confident zero, WhatsApp sends are uncounted and unpriced, SMS appear nowhere
type: FEATURE
priority: high
complexity: medium
area: admin, costs
found: "2026-09-10T17:10:00Z"
started: "2026-09-10T17:15:02Z"
merged: "2026-09-10T17:35:04Z"
---

# B1347 — The money dashboard under-counts: print costs are a confident zero, WhatsApp sends are uncounted and unpriced, SMS appear nowhere

## Why

`/admin#money` claims to show what the instance costs, and three of its groups
are wrong in the quiet direction:

- **Print is a confident zero.** `print_orders.cost_minor` is inserted as
  `null` (`lib/postcard/orders.ts:417`, `lib/photobook/orders.ts:125`) and no
  code ever updates it, even though both providers hand the real price back —
  Stannp in its create response (`lib/postcard/stannp.ts:121`), Gelato in the
  quote fetched at print time (`lib/photobook/print.ts:305`). `printCosts`
  (`lib/instanceCosts.ts:114`) sums the nulls to 0 with `unpriced: false`,
  which is exactly the "confident zero" the module's own header says it
  avoids. It would also sum GBP pence and EUR cents straight into the CHF
  total if the column were ever filled.
- **WhatsApp is barely counted.** Only day announcements leave a trace
  (`day_notifications`, one row per day regardless of recipients); reminder
  templates (`lib/digest/reminder.ts:134`) and authentication templates
  (`lib/phoneVerify/whatsapp.ts:24`, `app/api/auth/request/route.ts:357`)
  leave none, and nothing records Meta's billing category (marketing /
  utility / authentication), which is what Meta actually prices by.
- **Twilio SMS appear on no cost line.** `sms_messages` (B1316) is a message
  log for the SMS tab; `lib/instanceCosts.ts` never reads it.

Anthropic and Deepgram recording is complete and priced; not part of this
ticket. The three missing fixed subscriptions (Twilio, Claude dev, Stannp)
are a live-config edit, also not code.

## Work

Per the approved plan (`~/.claude/plans/rosy-kindling-catmull.md`):

- Persist provider print costs: thread Stannp's per-card `cost` through
  `handToProvider` → `recordResults` into `cost_minor`/`currency`; pass the
  Gelato quote into `recordPrint` the same way. Convert to CHF at read time in
  `printCosts` via `crossRate` over the ECB table; a currency with no rate is
  `unpriced: true`, never summed at face value.
- Record every outbound WhatsApp template send in a new `whatsapp_sends`
  table (owner, category, template, sent_at), category derived beside
  `templateFor` in `lib/whatsapp/settings.ts`. Price per category from a new
  optional `costs.whatsappPerMessageRappen` map (per-send approximates Meta's
  per-conversation billing; the line says so). `service` replies are free by
  Meta's own window rule and never "not priced".
- One SMS count line in "Sent to readers" from outbound `sms_messages`
  (counted, unpriced — the fixed Twilio line carries the number rental).
- Not doing: pricing mail, Twilio Verify accounting, per-message SMS pricing,
  charging journals (that is B1091's territory).

As built, two details differ from the sketch above and are deliberate:

- The category is a **required field on `WhatsappMessage`** rather than a
  name→category map in `settings.ts`: template names are configuration, so a
  mapping keyed on them breaks the moment an operator renames one. The type
  makes an uncategorised send a compile error, which is the stronger form of
  "a new template cannot be sent uncategorised". Free-form replies record
  `service` at the one choke point in `reply.ts`.
- Stannp's create response names a cost but no currency (it bills in the
  account's own), so the currency comes from a new optional
  `features.postcards.currency` string; unset, the cost is stored and /admin
  reports it as unconvertible rather than guessing. Gelato quotes already
  carry their currency (CHF), stored via the quote frozen at proposal/press
  (`quotedMinor`/`quotedCurrency` on the print block).

## Acceptance

- A postcard/photobook order that reached a provider carries `cost_minor` and
  `currency`, and `/admin#money`'s print lines show a CHF figure converted
  from the provider's currency (test: `test/instance-costs.test.ts`).
- Every WhatsApp template send (day, reminder, auth code) lands one row in
  `whatsapp_sends` with a category; the dashboard shows per-category counts,
  priced where the config prices them.
- Outbound SMS in the window appear as a counted line.
- `npm run verify` green.

---
id: B611
title: Printing and WhatsApp are opt-in per journal when they are the server's decision
type: FEATURE
priority: medium
complexity: low
area: capabilities
found: "2026-09-06T15:32:00Z"
---

# B611 — Printing and WhatsApp are opt-in per journal when they are the server's decision

## Why

`resolveOne` (`lib/capabilities.ts:196`) reads a journal's own `config.json`
for every capability, so a journal that has never written the word `photobook`
has no photobook button — and the page says nothing, because "not enabled by
<you>" never reaches a reader. Every real journal on the live instance was in
that state: the operator had paid for the printer and the WhatsApp number, the
server said yes, and the entry points (`lib/photobook/entry.ts:36`,
`lib/postcard/entry.ts:33`, `app/[user]/contacts/page.tsx:150-153`) were
absent for everyone. The demo journal was the only one that worked, because
somebody had edited its file by hand.

Three of the capabilities are the wrong shape for what they are:

- **`photobook` and `postcards`** spend the *operator's* money at a printer
  and are paid for in credits the operator issues. There is nothing for a
  journal to consent to, in either direction.
- **`whatsapp`** is a channel with a mute the owner can actually reach — the
  channels panel on `/<user>/me`, B463 — so it is `mail`'s shape (B60), not an
  opt-in: absence should mean no opinion, and only a written `false` a no.

`logging` and `credits` already had the first treatment, hard-coded by name in
two places (`app/api/health/route.ts:228`, `app/api/v1/[user]/config/route.ts`).

## Work

- `SERVER_ONLY = ["photobook", "postcards"]` in `lib/capabilities.ts`, exported,
  and skip the per-user check in `resolveOne` for those two.
- `whatsapp` joins `mail` in `USER_DEFAULT_FEATURES` (`lib/config.ts`), so
  absence inherits the server and a written `false` still mutes.
- `setJournalFeatures` refuses either of the two with `capability_not_yours`
  and writes nothing — a `200` on "turn my photobook off" while the button
  stays is worse than a refusal.
- `GET /api/v1/<user>/config` reports the server-resolved answer for them,
  the way it already does for `logging` and `credits` (B408's bug, one layer
  along).
- Document the refusal on `PATCH /api/v1/<user>/config` in `lib/api/openapi.ts`,
  and correct `docs/running-locally.md`, which told a reader to enable
  photobook in the journal's file as well.

Not doing: removing the `whatsapp` switch from `/<user>/me` (it stays, and is
the reason WhatsApp went the other way), and nothing about how credits are
bought or what the printers cost.

## Acceptance

- `npx vitest run test/server-only-capabilities.test.ts` — a journal naming
  none of the three has all three; a written `false` mutes WhatsApp and does
  nothing to the two printers; the server's `false` still closes all three.
- `npx vitest run test/journal-features.test.ts` — `PATCH` with
  `{"features": {"photobook": true}}` or `false` is refused
  `capability_not_yours` and leaves `config.json` untouched.
- On the live instance, a journal whose `config.json` names neither gets the
  photobook link on its gallery and the postcard entry on its contacts page.

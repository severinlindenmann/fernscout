---
id: B429
title: The invite form shows a canned mail-off line instead of the server's, losing which switch is off
type: ISSUE
priority: low
complexity: low
area: contacts
found: "2026-09-05T09:37:24Z"
started: "2026-09-07T11:06:07Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:06:07Z"
---

# B429 — The invite form shows a canned mail-off line instead of the server's, losing which switch is off

## Why

`app/api/contacts/redeem/route.ts` refuses with `503 {"error": "mail_disabled",
"message": "..."}` when mail cannot be sent, and its `message` already says
which of two switches is off — the journal's own (`features.mail.enabled:
false`) or the whole server's (`isEnabled("mail")` false) — with different
prose and a different remedy for each (B407: "the owner can turn it back on"
versus "the person who runs this server has to turn mail on").

`lib/contacts/redeemOutcome.ts:33` (before this ticket) collapsed both into
one canned key: `if (body.error === "mail_disabled") return { kind: "error",
error: "invite.noMail" }`. The reader in front of `InviteRedeem.tsx` therefore
saw the same single sentence regardless of which switch was actually off, and
`invite.noMail`'s wording ("This journal cannot send email") was flatly wrong
half the time — it named the journal even when the *server's* mail was the one
that was off. The distinction the server had already computed and put in
`message` was thrown away one function later, the same shape of loss B244
names for `approveContact`.

## Work

- Give the server response a machine-readable field alongside `message`,
  rather than making the client parse English prose to recover a fact the
  server already knows as a value (`mailOff`).
- `redeemOutcome` picks between two keys instead of one, on that field.
- Two i18n keys instead of one, each carrying the right remedy.

Not doing: touching `message`'s own wording (B407 already got that right) or
adding the distinction to `/api/contacts/confirm`'s equivalent path — that
route has no equivalent reader-facing refusal to begin with (confirmation
either succeeds or answers a uniform `401`).

## Acceptance

Redeeming a link with the *journal's* own mail off shows the reader a sentence
that says so and points at the owner; redeeming one with the *server's* mail
off shows a sentence that points at the operator. The two are different
strings, and a test drives both.

## Resolution

- `app/api/contacts/redeem/route.ts` — the `mail_disabled` response now
  carries `reason: mailOff` (`"journal" | "server"`) alongside the existing
  `message`, so a caller does not have to parse prose to recover a fact the
  server already computed.
- `lib/contacts/redeemOutcome.ts` — reads `body.reason` and returns
  `invite.noMailJournal` or `invite.noMailServer` instead of the single
  `invite.noMail`. An absent `reason` (an older server) falls back to the
  server-side sentence, the safer of the two guesses since it never tells the
  reader to blame the owner for something that is not the owner's to fix.
- `lib/i18n.ts` — `invite.noMail` replaced by `invite.noMailJournal` and
  `invite.noMailServer` in the `TranslationKey` union.
- `site/locales/{en,de,hu}.json` — the two new keys, each keeping the
  existing wording's shape (what happened, that nothing was saved, who can
  fix it) but naming the right party.

**Test**: `test/redeem-outcome.test.ts` — `mail_disabled` with `reason:
"journal"` maps to `invite.noMailJournal`, with `reason: "server"` to
`invite.noMailServer`, and with no `reason` at all to the server-side key
(the compatibility fallback). `test/redeem-mail-off.test.ts` — both existing
describe blocks (server mail off; journal mail off) now also assert
`result.body.reason` names the right switch, alongside the `message`
assertions already there. All pass.

**Contract**: `app/api/contacts/redeem` is not under `app/api/v1/` or
`app/api/auth/`, so it is outside `lib/api/openapi.ts`'s scope
(`test/openapi-contract.test.ts` scans only those two trees). Nothing to add
there.

**What this tells a non-owner caller**: nothing new that `message` did not
already say in words — `reason` only makes the same fact machine-readable.
Neither value names an address, a token or anything about who else is on the
journal.

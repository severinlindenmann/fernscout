---
id: B388
title: Resending a mailed guest invitation has no rate limit
type: ISSUE
priority: low
complexity: low
area: contacts, mail
found: "2026-09-04T22:11:29Z"
started: "2026-09-07T11:06:06Z"
merged: "2026-09-07T11:35:08Z"
completed: "2026-09-07T13:09:51Z"
---

# B388 — Resending a mailed guest invitation has no rate limit

## Why

B384 added `case "resend"` to `app/api/contacts/admin/route.ts` (~line 253):
the owner's page can ask to re-mail the invitation behind a still-pending,
unconfirmed contact row. It reuses the invite's existing link — no new invite
is minted — but every call still runs `sendInviteMail`, a real email to
`contact.email`, and there is no cooldown or per-contact counter. A
`claude-security` pass over that diff (run as part of B384) flagged it: low
severity, because `guard()` already requires the owner's own agent token or
guest cookie before this action is reachable at all, but nothing stops dozens
of sends per minute to the same address if that session is ever compromised
or scripted by mistake — the one cost is real mail landing in a stranger's
inbox on a loop, which is also the exact shape of complaint a mail provider
reads as abuse.

`sendCodeMail`'s own caller in `app/api/contacts/redeem/route.ts` has no
per-address limit either, but that path is gated by `rateLimitFor` on the
client IP one level up (`clientIp(request)`, 5 per 15 minutes) — the admin
route has no equivalent for any of its actions, `resend` included.

## Work

Add a per-contact (or per-address) throttle to `case "resend"` — a count and a
timestamp on the contact row, or a `rateLimitFor` keyed on the contact id,
whichever fits the existing shape in `lib/rateLimit.ts` most cheaply. Refuse
with a clear error rather than silently dropping the mail, the same way every
other refusal in this route already answers in words.

Not doing: touching `case "create"`'s own send (one mail per genuinely new
row, already naturally bounded by `contact_exists` refusing a second `create`
for the same address), or adding a limit to the public form's own code
issuance, which already has one.

## Acceptance

Calling `resend` for the same contact id more than a small number of times in
a short window is refused (429 or similar) rather than mailing again every
time. A test drives it past the limit and asserts the mail count stops
growing.

## Resolution

Confirmed against current code: `case "resend"` (`app/api/contacts/admin/
route.ts`) had no throttle of any kind, unlike `redeem`'s `clientIp`-keyed one
a level up.

Added `rateLimitFor("contact-resend", contact.id, { max: 3, windowMs: 60 *
60 * 1000 })` right after the `already_confirmed`/`no_invite` checks and
before the mail is sent, matching the shape already used by e.g.
`app/api/v1/[user]/payments/[id]/pay/route.ts`. Refuses with `429
too_many_requests` and a `Retry-After` header, same as every other
rate-limited route here — not silently dropping the mail.

Keyed on `contact.id` rather than the caller's IP, deliberately: the harm this
guards against is real mail landing repeatedly in *one address's* inbox, not
load on this server from one IP — an owner calling from home and from their
phone should still be limited together.

**Contract**: `app/api/contacts/admin/route.ts` is not under `app/api/v1/` or
`app/api/auth/`, so it is out of scope for `lib/api/openapi.ts` —
`test/openapi-contract.test.ts` and `test/api-route-schemas.test.ts` both scan
only those two trees. Nothing to add there.

**Test**: `test/contacts-admin-invite.test.ts`, new case "is refused past a
small number of calls in a window" — creates a pending row (which sends one
mail), calls `resend` three more times (all `200`), then a fourth (`429
too_many_requests`), and asserts no fourth mail landed on disk. Passes.

**What this tells a non-owner caller**: nothing — `guard()` still requires the
owner's own agent token or guest cookie before `resend` is reachable at all;
this only bounds what an already-authenticated owner session can do per
contact, which is the scenario the Why section names (a compromised or
scripted session).

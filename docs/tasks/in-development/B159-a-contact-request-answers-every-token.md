---
id: B159
title: A contact request answers every token identically but takes ten times longer for a live one
type: SECURITY
priority: medium
complexity: low
area: contacts, api, timing
found: "2026-09-03"
started: "2026-09-03T19:48:58Z"
session: d6791268-ed45-4a69-acde-99f9e5f10516
claimed: "2026-09-03T19:48:58Z"
---

# B159 — The uniform 202 is uniform in everything but latency

## Why

Found while verifying B37, which passes. B37 made
`POST /api/contacts/request` answer identically whatever token it is given, so
that the endpoint cannot "become a way to test whether a token is still live".
The **body** achieves that perfectly — four probes on the live site, with no
token, a revoked token, an invented token and a live one, returned
byte-identical `202 {"status":"accepted"}` with identical headers, and only the
live one created a row or sent mail.

The **clock** does not:

| token | response time |
| --- | --- |
| none | 0.197 s |
| revoked | 0.200 s |
| invented | 0.185 s |
| **live** | **1.95 s** |

Roughly ten times, and the code explains it exactly. A dead token returns at
`app/api/contacts/request/route.ts` (~line 118, `if (!invite || invite.kind ===
"buddy") return 202`) before doing any work. A live one does a database insert,
then `issueCode`, then `sendCodeMail` — SMTP plus an `.eml` write — all on the
response path.

So the question B37 set out to make unanswerable is answerable, just not from
the body. Anybody holding a guest link can tell whether it is still live, which
is the fact B37 decided they should not learn: it distinguishes "this invite
was revoked" from "this address is wrong", and it makes a leaked or forwarded
token testable.

Two things keep this at medium rather than high. It needs a candidate token —
tokens are 24 random characters, so this is not an enumeration route, it is a
check on a token you already have. And C15's rate limit (5 per 15 minutes per
IP) makes each check expensive; the B37 agent consumed 4 of 5 slots running
this very experiment. Single sample per case, so treat the exact magnitude as
indicative rather than measured.

## Work

Take the work off the response path.

- Answer `202` first, then do the insert, the code and the mail. The endpoint
  already promises nothing about what happened, so there is nothing to wait
  for. This is the real fix and it makes the timings converge on the fast case
  rather than the slow one.
- If that is awkward — the send is guarded and a failure currently takes the
  code back with it — the alternative is to pad the dead branch to a similar
  duration. Weaker, and it makes every refusal slow on purpose, but it is one
  line.

Either way, add a test that asserts the two branches are within some band of
each other, or the property will drift back the first time somebody adds work
to the live path.

Also, small and in the same file: `POST /<user>/join` returns **405**, not the
`308` its own comment at `app/[user]/join/route.ts:25-27` describes ("the
method is preserved so a stray POST is not quietly turned into a GET of
somebody's access page"). The route exports only `GET`, so Next refuses the
method before the handler runs. The outcome is still safe — no form, no GET
conversion — but the comment describes a mechanism that is not what happens.
Fix the comment or export the redirect for POST too.

## Acceptance

- A live, a revoked and an absent invite token produce response times that do
  not separate them, measured over several samples.
- The body and headers stay identical, as B37 established.
- A test guards the timing property.
- `app/[user]/join/route.ts`'s comment matches what the route does.

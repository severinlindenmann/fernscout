---
id: B159
title: A contact request answers every token identically but takes ten times longer for a live one
type: SECURITY
priority: medium
complexity: low
area: contacts, api, timing
found: "2026-09-03"
started: "2026-09-03T19:48:58Z"
merged: "2026-09-03T20:05:17Z"
completed: "2026-09-04T06:18:51Z"
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

## What was built

The Why held up and the **real fix** was taken, not the padding fallback: the
insert, `issueCode` and `sendCodeMail` now run after the response instead of
before it. Everything still on the response path is work a dead token does too,
so the branches converge on the fast case rather than the slow one — which is
the whole reason to prefer this shape to padding.

It also closes a **second, louder signal the ticket did not name**:
`sendCodeMail` throwing used to surface as a 500, and only a live token could
ever produce one. A failed send is now a log line, which is right — by the time
it happens the response is gone, and the caller was never promised the mail.

**`lib/afterResponse.ts` is new**, and its existence is the one thing worth
arguing with. Next's `after` is the correct primitive and is supported on the
Node server this deploys to, but it throws outside a request scope, and this
repository tests route handlers by importing `POST` and calling it. A bare
`after` would have meant the timing property could only be tested by standing
up a server. So the helper uses `after` when there is a request scope and
otherwise starts the task detached and tracks it, which `flushAfterResponse()`
waits on. Both paths swallow failures into the log.

That has a visible cost in the suite, and it is the honest one: eleven existing
assertions in `test/contacts.test.ts` read the database immediately after
`POST` returned. They now `await flushAfterResponse()` in the three helpers
that post. A test that asserts on work the route no longer waits for has to
wait for it itself.

**The guard is an ordering assertion, not a stopwatch.** The primary test
holds the mocked send open and asserts the `202` is in hand while the mail is
still unsent, then that it is sent afterwards and the contact row exists.
Wall-clock comparison proves the property only for whatever the machine was
doing that second; this fails deterministically if the work moves back onto
the response path — before the fix both timing tests hang for five seconds and
time out. A median-over-three-samples case follows it for the shape of the
original measurement, with a deliberately loose bound: it exists to catch the
order-of-magnitude regression B159 measured, not a millisecond between one
database read and none.

**The join route:** the comment was fixed rather than `POST` exported. The
concern it describes — a stray POST quietly becoming a GET of somebody's
access page — is already answered one step earlier and more bluntly, since
only `GET` is exported and Next returns 405 before the handler runs. Exporting
a redirect for POST would weaken that to serve a form that no longer exists.

**Captured B197, then withdrew it.** A full run on this branch found
`test/mail.test.ts > a sweep that cannot read the directory still sends the
message` failing, traced to B60's new `isEnabled("mail", username)` gate
resolving through `getUsernames()`, whose `readdirSync` catch turns an
unreadable content root into "no such journal" into "mail is off". The
diagnosis was right and the B60 session was making it at the same moment: they
merged the fix in `2500704` about a minute after the capture was written.
B197 is kept, marked as already fixed, and says so — an id has to mean one
thing forever, but it must not go on claiming a bug that is closed.

Worth recording as a hazard rather than a bug: that run was `npx vitest run` in
the main checkout while another agent was merging into it, so it saw a tree
that never existed. One of its two failures never reproduced at all. A full
suite run on `main` is only trustworthy if nothing is landing under it.

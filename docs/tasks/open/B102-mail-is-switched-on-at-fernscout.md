---
id: B102
title: Mail is switched on at fernscout.ch and nothing records that a message has ever arrived
type: OPS
priority: high
complexity: medium
area: mail, ops, capabilities
found: "2026-09-03"
related: B103, B104, B105, B106, B107, B108, B109, B110
---

# B102 — Mail is switched on at fernscout.ch and nothing records that a message has ever arrived

## Why

**Note, 2026-09-05.** The per-journal half of the reading below can no longer
be taken from `/api/health`: B473 stopped it naming journals and their
capability posture. The server switches are all still on. Whether a journal
has this one on is a question for the server now, not the endpoint.

`/api/health` on 2026-09-03 (commit `3592ad3`) reports `mail` **enabled at the
server**, with `keepingCopies: true` — and disabled in every journal on the
instance: `not enabled by sevi`, `by sevi2`, `by test1`. So there is a
transport configured and nothing using it. Nobody can say from the outside
whether a message fernscout.ch sends is ever received.

That matters more than the feature's own size, because almost everything else
arrives by mail: the six-digit sign-in code (`app/api/auth/request`), the
welcome mail, both invite links (`lib/contacts/invites.ts`), the digest, and
the deletion confirmation — which is deliberately the one step an agent cannot
finish, precisely because it lands in a mailbox (`lib/deletions.ts`, B38).
If mail does not arrive at fernscout.ch, none of those work, and each of them
fails silently.

Local development proves none of it. The `file` transport writes `.eml` under
`content/<user>/mail/`, which shows the template renders — not that SMTP
authenticates, not that the From address survives SPF and DKIM at the
receiving end, not that the message escapes a spam folder. B58 is the same gap
seen from the other side: `SmtpTransport` cannot be driven to a successful send
from a test either.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

Enable mail for a test journal (the server side is already on) and confirm
`/api/health` flips for that journal. Then send one of each kind of mail this
instance can send, to an inbox you control, and look at what arrives:

- the sign-in code, the welcome mail, a guest invite, a buddy invite, a digest,
  and a deletion link;
- for each: did it arrive at all, and in which folder; the From and Reply-To;
  the subject; whether every link points at the right host and actually works;
- the locale — B26 says the welcome mail is English only and that nobody is
  asked what language the journal is in. Confirm whether that reached
  production;
- read back the copies kept under `content/<user>/mail/` and check they match
  what landed in the inbox (B57).

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- A note in this task listing each of the six mails, where it landed, and what
  it looked like — including any that could not be triggered at all.
- One backlog task per defect, referencing B102.
- `/api/health` shown reporting mail enabled for the journal used.
- No journal in real use had its config changed, or this task says what was
  left switched on.

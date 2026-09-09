---
id: B102
title: Mail is switched on at fernscout.ch and nothing records that a message has ever arrived
type: OPS
priority: high
complexity: medium
area: mail, ops, capabilities
found: "2026-09-03"
related: B103, B104, B105, B106, B107, B108, B109, B110
started: "2026-09-09T18:01:44Z"
merged: "2026-09-09T18:03:10Z"
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

---

## The run — 2026-09-09, against fernscout.ch

Instance at commit `bb50b142`. `/api/health` reports `mail` enabled with
`keepingCopies: true`; `site/config.json` on the server has
`{"enabled": true, "transport": "smtp", "keepCopy": true}` — a real relay, not
the file transport.

Two journals were created for this and **both are still on the instance** — see
"What was left behind" at the end.

- `test-b102-mail`, owner `test@severin.io`, `defaultLocale: en`
- `test-b102-de`, owner `de-b102@severin.io`, `defaultLocale: de`

### What was sent, and what it looked like

Every mail below was accepted by the relay: the app log records
`[mail:smtp] <address> — "<subject>" -> 2.0.0 Ok: queued as <id>` for each one,
and a copy under `<dataDir>/mail/<journal>/`. There is no MTA on the box, so
**the queue id is the last thing this server can see.** Whether each message
reached the inbox, and in which folder, is the one question this run could not
answer from here — the address is not one this session can read. That half is
outstanding and is listed under "Still needs a person" below.

Nine kinds went out, not six — the ticket's list was written before some of
these existed.

| Mail | Trigger | Subject | Verdict |
| --- | --- | --- | --- |
| Signup code | `POST /api/auth/signup/request` | *Your code to start a journal on Fernscout* | Correct. Code, 30 minutes, "nothing has been created" reassurance. English by default — see B1134 |
| Welcome | `POST /api/v1/journals` | *Your journal is ready — …* | Correct, and long: the address, a standing sign-in link, the draft rule, and how to write later. German journal got real German (below) |
| Agent code | `POST /api/auth/request` `kind: agent` | *Your agent code for Fernscout* | Correct. Says 30 minutes, says a token that writes for seven days |
| Guest code + one-tap | `POST /api/auth/request` `kind: guest` | *Sign in to <journal>* | Correct. Button **and** the six digits underneath |
| Trip-scoped agent code | `…request` with `trip:` | *Your agent code for Fernscout* | Correct, and names the trip: "write to one journey … and nothing else in the journal" |
| Guest invite | `POST …/invites` `kind: guest` | *Ops invited you to follow …* | Correct |
| Buddy invite | `POST …/invites` `kind: buddy` | *Ops invited you to help write <trip>* | Correct, and names the trip |
| Address confirmation | `POST /api/contacts/redeem` | *Your code for <journal>* | **Wrong sentence — B1132** |
| "You're in" | `POST /api/contacts/confirm` | *You're in — <journal>* | Correct. Carries the manage link and *Stop these emails* |
| Day letter | publish with `send_mail: true` | *<day> — a new day on <journal>* | Correct for a contact. **Owner's copy is wrong — B1133** |
| Deletion link | `DELETE /api/v1/<user>` | *„…" löschen? Gelöscht ist noch nichts* | Correct, and the best of them: what would go, the credits that would be lost, an export link first, 60 minutes, once |

**From and Reply-To.** Every message is `From: Fernscout <agent@fernscout.ch>`.
No `Reply-To` on any of them, and no `Sender`. That is a deliberate-looking
choice rather than an omission — a reply would go to an unattended address
either way — so it is recorded, not filed.

**`List-Unsubscribe`.** Present, with `List-Unsubscribe-Post:
List-Unsubscribe=One-Click`, on the day letter to a contact. Absent on the
transactional mails, which is correct — they are not bulk. Absent on the
owner's copy of the day letter, which is B1133.

**Links.** Every link in every mail pointed at `https://fernscout.ch/…`. The
ones that could be followed were followed: the one-tap sign-in link, the
standing welcome link, both invite links, the manage and unsubscribe links, and
the deletion page. All resolved. The deletion button was **not** pressed — that
step is a person's (B38).

**Locale.** B26 is fixed in production and this run is the evidence. The German
journal's welcome mail, agent-code mail and deletion mail all arrived in real
German — *"Dein Reisetagebuch ist bereit"*, *"Gelöscht ist noch nichts"* — not
a translated shell around English. The one gap in front of it is B1134: the two
mails that go out *before* a journal exists take their language from
`Accept-Language`, which works but is documented nowhere an agent reads.

**Copies versus what was sent (B57).** The copies under
`<dataDir>/mail/<journal>/` are byte-for-byte what the transport was handed —
same MIME structure, same base64 parts, same headers including
`List-Unsubscribe`. Sweeping works and is visible in the log
(`[mail] swept 6 expired .eml from …/.mail`). No discrepancy found.

### Defects filed

- **B1132** — the address-confirmation mail says "Nothing opens yet — whoever
  keeps the journal still decides who comes in" to somebody holding a
  pre-approved invite, who is admitted the moment they press it.
- **B1133** — the owner's own copy of a day letter tells them they asked to be
  kept posted, and offers no way to stop it.
- **B1134** — `Accept-Language` is the only lever on the language of the two
  pre-journal mails, and no agent-facing document mentions it.

B103 filed two more from the same session: B1130 and B1131.

### `/api/health` for the journal used

B473 stopped `/api/health` naming journals, so the per-journal posture is not
readable from the endpoint any more and the ticket's acceptance line cannot be
met as written. What can be shown instead: mail is on at the server —

```
"mail":{"enabled":true,"keepingCopies":true}
```

— and it is on for `test-b102-mail`, demonstrated rather than asserted: eleven
messages were sent for that journal in this run and each is in the log with a
relay queue id. A journal with mail off sends none.

### Delivery, confirmed by the owner — 2026-09-09

The half this session could not reach from the server, answered by the person
who can open the mailboxes:

- **Every mail landed in the inbox. None was filtered to spam or junk.**
  Confirmed for `test@severin.io`, `de-b102@severin.io` and
  `de2-b102@severin.io`.
- Two were quoted back verbatim and match the copies on disk exactly — the
  German signup code (*"Ein Reisetagebuch beginnen … Dein Code lautet 212887.
  Er gilt 30 Minuten."*) and the deletion link for `test-b102-de`. So the
  copies under `<dataDir>/mail/` are what actually arrived, not merely what was
  handed to the transport. That closes the B57 half of this ticket with
  evidence from both ends.

Sender authentication, read from DNS rather than from a header:

```
fernscout.ch          TXT   "v=spf1 include:_spf.protonmail.ch ~all"
_dmarc.fernscout.ch   TXT   "v=DMARC1; p=quarantine;"
protonmail{,2,3}._domainkey.fernscout.ch  CNAME  …domains.proton.ch.
```

SPF, three DKIM selectors and DMARC at `quarantine`, all present and consistent
with inbox placement at two unrelated receiving domains — `severin.io` here, and
`gmail.com` on 2026-09-06. **Mail from this instance is delivered.** That is the
question B102 was asked and the answer is yes.

One gap remains and is filed as **B1135**: the DMARC record has no `rua=`, so
nothing would tell the operator if this stopped being true.

### Still needs a person

**The two test journals are still there**, and they are the only thing this
engagement left behind. `test-b102-de` has a deletion mail waiting at
`de-b102@severin.io`; the link on it is good for 60 minutes from 17:57 UTC on
2026-09-09, and a fresh one is a `DELETE` away if it has lapsed.
`test-b102-mail` has had no deletion requested — ask for one when the findings
in B1130–B1135 no longer need the journal to reproduce against.

Pressing the button is a person's step, by design (B38), and no agent in this
run pressed it. Nothing was written into any journal in real use.

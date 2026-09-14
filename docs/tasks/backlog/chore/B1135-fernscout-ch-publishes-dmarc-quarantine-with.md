---
id: B1135
title: fernscout.ch publishes DMARC quarantine with no rua, so nobody would learn if mail stopped being accepted
type: CHORE
priority: low
complexity: low
area: ops, mail, dns
found: "2026-09-09T18:25:39Z"
---

# B1135 — fernscout.ch publishes DMARC quarantine with no rua, so nobody would learn if mail stopped being accepted

Found during B102, against fernscout.ch on 2026-09-09.

## Why

The domain's sender authentication is set up and working. As published today:

```
fernscout.ch          TXT   "v=spf1 include:_spf.protonmail.ch ~all"
_dmarc.fernscout.ch   TXT   "v=DMARC1; p=quarantine;"
protonmail{,2,3}._domainkey.fernscout.ch  CNAME  …domains.proton.ch.
```

SPF, three DKIM selectors, DMARC at `quarantine`. Mail from
`agent@fernscout.ch` reached the inbox — not the spam folder — at both a
third-party `severin.io` mailbox and, on 2026-09-06, at a `gmail.com` one. So
this is not a ticket about mail being broken. It works.

It is a ticket about **finding out when it stops.** The DMARC record carries no
`rua=`, so no aggregate reports are sent anywhere, and there is no other
feedback channel: `scripts/backup.sh` watches backups, `/api/health` watches
capabilities, and nothing at all watches whether messages from this domain are
still being accepted. B102's opening sentence — *"nothing records that a message
has ever arrived"* — is still true at the domain level after that engagement,
and everything this instance does arrives by mail: the sign-in code, both invite
links, the day letter, and the deletion confirmation that is deliberately the
one step an agent cannot finish.

The failure mode is quiet. A reputation change, an expired DKIM record, a Proton
policy change — each shows up as codes that never arrive, reported by a person
who assumes they typed something wrong.

## Work

Add `rua=mailto:…` to the `_dmarc.fernscout.ch` record, pointed at an address
the operator reads. One DNS edit; no code.

Two things to decide at the same time, since it is the same record and the same
five minutes:

- `~all` (softfail) versus `-all` (hardfail) on the SPF record. With DMARC at
  `quarantine` the practical difference is small, and `-all` is the stricter
  statement. Not obviously worth changing — note the decision either way.
- Whether `p=quarantine` should become `p=reject` once reports have been read
  for a few weeks. Do not do this before reading reports; that is what the
  reports are for.

Not doing: building anything that parses the reports. A monthly aggregate mail
that a person glances at is the whole of it, and a parser here would be a
service to run.

## Acceptance

- `dig +short TXT _dmarc.fernscout.ch` shows a `rua=`.
- One aggregate report has arrived at that address and been opened, so the
  channel is known to work rather than assumed to.

## Checked 2026-09-14 — still open, DNS only, cannot be done from a checkout

`dig +short TXT _dmarc.fernscout.ch` today:

```
"v=DMARC1; p=quarantine;"
```

`dig +short TXT fernscout.ch` today:

```
"protonmail-verification=3875d328563042f3022236682a73ab15abfafce7"
"v=spf1 include:_spf.protonmail.ch ~all"
"google-site-verification=AJqAt52qzfzoRe5r6KTsByGucLOCephkE_5fIOMdrtw"
```

Unchanged from the ticket's own findings — no `rua=` published, SPF still
`~all`. This is a registrar-side DNS edit; no agent working in this
repository can make it. Exact replacement to paste at the registrar:

```
_dmarc.fernscout.ch   TXT   "v=DMARC1; p=quarantine; rua=mailto:agent@fernscout.ch;"
```

`agent@fernscout.ch` is this instance's existing, already-monitored public
contact address (not a new mailbox to stand up) — a real inbox to point
reports at rather than one invented for this ticket. If the operator would
rather reports land somewhere else, swap the address only; the rest of the
record is unaffected.

On the two open decisions the ticket names:

- **SPF `~all` vs `-all`**: not changed here. Left as a decision for whoever
  applies the DNS edit — the ticket already argues `-all` is the stricter,
  probably-fine choice; this pass adds no new evidence either way.
- **`p=quarantine` vs `p=reject`**: explicitly not yet — the ticket's own
  instruction is to wait until aggregate reports have actually been read, and
  with no `rua=` published yet, none exist to read.

Leaving this ticket in the backlog, not testing/completed: nothing here was
applied, and the acceptance criteria (a `rua=` published, one report received
and opened) cannot be met without registrar access and a few weeks' wait.

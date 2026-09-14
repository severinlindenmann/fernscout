---
id: B1695
title: B403's account of never having delivered a WhatsApp announcement is stale
type: OPS
priority: medium
complexity: low
area: whatsapp, live instance
found: "2026-09-14T06:17:18Z"
merged: "2026-09-14T06:35:42Z"
---

# B1695 — B403's account of never having delivered a WhatsApp announcement is stale

## Why

B403 (found 2026-09-05) records the template as `PENDING` and the whole
channel as "configured and unproven." That was true on 2026-09-05. It is not
true now, and the ticket has not been updated to say so.

Checked directly against the live instance on 2026-09-14:

- `GET /1043886595223059/message_templates?name=fernscout_day_published_v2`
  returns all three locales **APPROVED**, category `MARKETING` — not
  `PENDING`.
- The application log carries two real outbound sends on 2026-09-06 18:55
  (`[whatsapp:cloud] …3150 — fernscout_day_published_v2/de -> wamid…` and
  `…8207 — fernscout_day_published_v2/hu -> wamid…`), immediately preceded in
  the same second-by-second block by the matching `[mail:smtp]` sends for the
  same day-publish event on the `severin` journal (a real trip, real
  recipients — not `example`, not a test). This was a real day publication,
  not the manual API test B403 records.
- `GET /1043886595223059?fields=pricing_analytics…` shows real spend against
  it: `MARKETING`/`REGULAR`, volume 2, cost €0.098 in the 2026-09-06 daily
  bucket — €0.049/message, which is the **measured** rate B403's acceptance
  asks for (its own estimate was €0.04–0.09). A further single `MARKETING`
  send (€0.049) is billed in the 2026-09-10 bucket with no corresponding
  `[whatsapp:cloud]` log line found anywhere in the journal — see B1696.

So: the template is approved, a real announcement has been delivered (Meta
accepted and, going by conversation-based billing, very likely delivered —
this server does not process delivery-status webhooks, see
`lib/whatsapp/inbound.ts:184`, so "accepted by Meta" is as far as the
server's own records can confirm), and the measured MARKETING rate is
€0.049/message. None of B403's "Where it stands" table or "Resume here"
section reflects this.

## Work

Someone who can re-read B403 alongside this finding should:

- Update B403's "Where it stands" table (`Templates: PENDING` →
  `APPROVED`) and its cost table (replace the €0.04–0.09 marketing estimate
  with the measured €0.049).
- Decide whether B403's remaining acceptance items are now met (a template
  shows `APPROVED` and a real send happened — the one unmet item is that
  nobody has confirmed the message *displayed correctly* — photo, three
  variables, working button — on a real device, since delivery-status is
  invisible to this server).
- Delete or properly approve the hand-approved test contact
  (`wants_whatsapp = 1`, added directly in Postgres, still outstanding per
  B403's own acceptance).

Not doing: reading or reporting the actual recipient numbers, journal
content, or contact rows — this ticket is deliberately conducted from the
Graph API's own ids and the server's masked log lines only.

## Acceptance

B403 is re-read against this ticket's evidence and either updated to reflect
the current state or superseded/closed with a note explaining why.

---
id: B1809
title: A WhatsApp message that Meta accepts and then fails to deliver leaves no trace on this server
type: ISSUE
priority: high
complexity: low
area: whatsapp, observability
found: "2026-09-16T18:50:00Z"
wontDo: "Already fixed and merged to main before triage (d2e71366, e1e74904, 3660ccb3): the webhook now parses Meta's statuses[] and logs a refused delivery with the masked recipient, reason and wamid."
---

# B1809 — A WhatsApp message that Meta accepts and then fails to deliver leaves no trace on this server

## Why

`app/api/webhooks/whatsapp/route.ts` calls `parseInboundMessages(body)` and
iterates only the messages. **Meta's `statuses` array — `sent`, `delivered`,
`read`, `failed`, each `failed` one carrying an error code and title — is
parsed away and discarded.** The route answers `{ok: true, received: N}` and
logs nothing.

So a message the Graph API answers `message_status: accepted` for, and which
Meta then declines to deliver, is indistinguishable here from one that
arrived. The send looks successful at every point this instance can observe.

Found live on 2026-09-16 while switching to the new number (B1791): a
`fernscout_day_published_v2` template was accepted with a wamid, exactly one
webhook callback followed, and the recipient never received it. The reason
was in that callback and this server threw it away. Meta's own Insights UI
was not an alternative — it refused with *"Nur ein WABA-Admin kann Insights
bestätigen"*.

This matters beyond the migration: day announcements are the product. A
family being silently not-notified, with the operator's logs saying the
message went, is the failure mode this leaves wide open.

## Work

Smallest thing that removes the blindness:

- Parse `entry[].changes[].value.statuses[]` alongside the messages.
- `console.error` a `failed` status with its `recipient_id` (masked, as
  `maskNumber` does everywhere else here), the wamid, and the error `code` +
  `title` Meta supplies.
- A non-failed status needs no line — `sent`/`delivered`/`read` on every
  message would drown the log. Consider one `console.log` for `delivered`
  only if it proves useful; do not add per-status noise by default.

Do **not** build a status store, a dashboard or a retry. The defect is that
the reason is thrown away, not that it is unrecorded.

## Acceptance

A WhatsApp send that Meta accepts and then fails produces a log line naming
the recipient (masked), the wamid and Meta's own error code and title.
`npm run verify` clean.

## Closed unbuilt

Decided against on 2026-09-16 during a triage of every issue, chore, docs, ops and security ticket in the backlog. Already fixed and merged to main before triage (d2e71366, e1e74904, 3660ccb3): the webhook now parses Meta's statuses[] and logs a refused delivery with the masked recipient, reason and wamid.

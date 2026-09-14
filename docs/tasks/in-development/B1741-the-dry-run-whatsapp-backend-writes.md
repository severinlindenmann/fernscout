---
id: B1741
title: The dry-run WhatsApp backend writes every outbound body to disk, now including a live invite token
type: ISSUE
priority: low
complexity: low
area: whatsapp, dev
found: "2026-09-14T16:26:19Z"
started: "2026-09-14T16:33:09Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T16:33:09Z"
---

# B1741 — The dry-run WhatsApp backend keeps every outbound body

## Why

`lib/whatsapp/reply.ts:sendDryRun` writes the complete outbound message body to
`content/<user>/whatsapp-replies/*.json` and to `console.log`, for every reply,
whenever `features.whatsapp.backend` is `dry-run`. The `cloud` backend does not:
it posts to Graph and logs nothing of the body.

Raised by the security review of B1736, which is the reason it is worth writing
down rather than leaving as a known dev convenience. Since B1736 a pressed
`invite_guest` returns its link in that body, so a dry-run instance now writes a
**live guest invite token** into a file under a real content root. The token is
otherwise deliberately shown once and stored only as a hash
(`app/api/helper/[user]/invite/route.ts`), which is the property this quietly
undoes wherever dry-run is pointed at content that matters.

The behaviour predates B1736 for every other body and is correct for what it is
for — the reply files are how the test suite reads what went out. The question
is only whether anything stops a dry-run instance being pointed at a real
`CONTENT_DIR`, and today nothing does.

## Work

- Decide whether dry-run should refuse a `CONTENT_DIR` that holds a real
  journal, or whether the reply files should live under `DATA_DIR` rather than
  inside somebody's content folder. The second is probably right: they are not
  the person's content.
- Whatever is chosen, keep the suite's ability to read what went out — that is
  what the files are for.

## Acceptance

- A dry-run instance does not write an outbound body inside
  `content/<user>/`, or refuses to run against real content.
- The WhatsApp tests still assert on what was sent.

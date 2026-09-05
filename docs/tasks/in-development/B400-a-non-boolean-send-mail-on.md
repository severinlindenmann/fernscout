---
id: B400
title: A non-boolean send_mail on publish is silently ignored, so an agent thinks it sent
type: ISSUE
priority: low
complexity: low
area: api, publish, dx
found: "2026-09-05T07:24:42Z"
started: "2026-09-05T07:30:50Z"
session: 3d8b93dd-e447-4c3c-bcd1-fa37e2bd17f9
claimed: "2026-09-05T07:30:50Z"
---

# B400 — A non-boolean send_mail on publish is silently ignored, so an agent thinks it sent

## Why

Found during the live credit-system pen test (authorized). `readPublishFlags`
(`lib/api/publishFlags.ts`) reads `send_mail`/`send_whatsapp` with a strict
`=== true`, on purpose: a client sending `"send_mail": "no"` must never be read
as a yes (the doc comment says so, and that is correct). But the *other* side of
strictness is invisible. Publishing with `send_mail: "true"` (a string), `1`,
or `[true]` returns `200`, publishes the day, and attaches **no** `mail` key to
the response — the flag was read as false and nothing was sent. Confirmed live:
`{"send_mail":"true"}` and `{"send_mail":1}` both published for free with no
send and no error.

For a person that is safe (it never sends when unsure). For an **agent** — which
is the entire audience of this API — it is a quiet failure: it believes it asked
for a letter, gets a success with no error, and reports "published and mailed"
when nothing went out. The one reader who needed to hear had no letter and
nobody was told.

## Work

Do not loosen the `=== true` check — that guarantee is load-bearing. Instead make
the *ignored* case audible, in the response only:

- In the publish route, when `send_mail`/`send_whatsapp` is **present** in the
  body but is not a boolean, add a note to the response (e.g. a
  `flagsIgnored: ["send_mail"]` field, or a line in `note`) saying the flag was
  not a boolean and so nothing was sent — "send `true`, not `\"true\"`". Absence
  of the key stays silent (that is the honest "did not ask").
- The distinction is "present but wrong type" vs "absent". `readPublishFlags`
  currently collapses both to `false`; it needs to return enough for the route
  to tell them apart (e.g. `{ sendMail: boolean, sendMailIgnored: boolean }`),
  without changing what actually triggers a send.
- Document it in `agent.md`/`openapi.json` where the flags are described: the
  value must be boolean `true`, and a non-boolean is ignored (and now reported).

Keep it to the response — this is a DX/telemetry fix, not a behaviour change to
what sends.

## Acceptance

- `npm run verify` green.
- A route test: publish with `send_mail: "true"` (string) and `send_mail: 1`
  publishes, sends nothing, and the response names the ignored flag; publish
  with `send_mail: true` sends as before; publish with no `send_mail` key sends
  nothing and reports nothing ignored.
- The strict `=== true` behaviour of `readPublishFlags` is unchanged (its
  existing tests still pass).

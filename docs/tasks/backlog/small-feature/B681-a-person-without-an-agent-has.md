---
id: B681
title: A person without an agent has nowhere to start
type: FEATURE
priority: high
complexity: medium
area: agent, auth, ui
found: "2026-09-07T09:52:48Z"
---

# B681 — A person without an agent has nowhere to start

## Why

The helper at `/agent` is planned in `docs/plans/2026-09-07-web-helper-agent.md`,
and none of it can be reached without a door. Today `/agent` is nothing — only
`/agent.md`, which is a document for something that already knows what an API
is. The person this whole feature is for arrives with a phone and a photo
library and meets a 404.

This is also the task that decides what somebody sees when the `helper`
capability is off, which is the default and is what every self-hosted instance
will have. That page must be useful rather than broken: bring-your-own-agent is
not a fallback, it is the promise the project is built on.

## Work

- `app/agent/page.tsx` — signed out: what the helper is, the email + code form,
  and the bring-your-own-agent panel. Signed in: the journal, and the buttons
  the later tasks fill in.
- Add `agent` to `reserved` in `site/config.json`. It is not there today and a
  journal called `agent` would collide with the route.
- The bring-your-own panel is present whether the capability is on or off, and
  offers a copyable starter prompt built from the journal, the base URL and a
  handover credential (`POST /api/v1/<user>/handover`, B283).
- Reuse `resolveAccess()` for the session; a reader may hold either credential.
- Mobile first, 390px, `ConfirmPanel` for anything that asks — never a browser
  dialog (B633, B668).

Not doing: the wizard (B682), any model call, any capability.

## Acceptance

`/agent` signed out shows the sign-in and the other door; signed in it names
the journal. With `helper` off — the default — the page is complete rather
than degraded, and the starter prompt copies something that actually works
against `/api/v1/`. Checked at 390px in a real browser.

---
id: B153
title: A journal created through the API can never invite anybody, because contacts is off and nothing can turn it on
type: ISSUE
priority: high
complexity: low
area: contacts, journals, api
found: "2026-09-03"
started: "2026-09-03T19:42:15Z"
session: ea97c35d-5c6a-4610-ab68-d1575d52ea4f
claimed: "2026-09-03T19:42:15Z"
---

# B153 — A new journal cannot share itself, and cannot be made to

## Why

Found while trying to verify B33 against the live instance. B33's code is
deployed and correct — the routes exist, the guards work, `agent.md` and
`openapi.json` document both link kinds. It could not be tested, because on
every journal an agent can create, the feature is switched off and there is no
call that switches it on.

```
POST /api/v1/xydhd-qa1/invites   {"kind":"guest"}
-> 404 {"error":"contacts_disabled",
        "message":"This journal does not have contacts switched on, so it has
                   nobody to invite and no queue for a redemption to land in."}
```

The same 404 on `xydhd-qa1` through `qa4`, all created through
`POST /api/v1/journals` today. `/api/health` shows why: `contacts` is enabled
at server level and reports `{"enabled":false,"reason":"not enabled by <user>"}`
for every journal on the instance except `example`.

The chain:

- `lib/journals.ts:232` — `createJournal` writes `features: { reactions, costs,
  auth }`. Contacts is not among them, ever.
- `lib/config.ts:166` — the default for `contacts` is `{ enabled: false }`.
- A grep over `app/` and `lib/` finds **no endpoint, no MCP tool and no page
  that writes a user's `features` block.** Nothing an agent or an owner can
  call changes it.

So the only way to switch contacts on is to hand-edit
`content/<user>/config.json` on the server, over SSH. For a self-hostable
product whose entire writing story is "an agent does it for you", that is a
door with no handle on the inside.

**What it costs is the whole sharing story.** B39 removed trip passwords, which
means invite links are now the only way to let anybody into a journal. So an
agent that has just built somebody their journal — B33's own *Why* says "the
occasion for all of this is journal creation" — gets, on the very next call,
`404 contacts_disabled`. The person is told their journal is ready and there is
no way to show it to their family. Every journal created since B33 merged is in
that state.

It also blocks verification of a whole cluster: B33, B37, B41, B52, B68, B74,
B79 and B80 all need a journal with contacts on, and none can be reached
without server access.

## Work

Decide what contacts is, then make it reachable.

Two coherent answers:

1. **On by default for a new journal.** `createJournal` writes `contacts:
   { enabled: true }` alongside the other three. Contacts is not a paid or
   risky capability — it is off at the server level until an operator turns it
   on, and that switch is the real gate. Once the operator has said yes, a
   journal wanting to invite people is the ordinary case, not the exception.
2. **A way to turn it on.** A `PATCH` on the journal's own config, owner-only,
   able to toggle the per-journal half of a capability the server already
   allows. More surface, but it makes the whole `features` block reachable
   rather than just this one flag.

The first is probably right, and the second may be worth having anyway — but
note that today *no* per-journal feature can be changed after creation, so the
second is a larger decision than it looks.

Whichever: an agent creating a journal should be able to follow it with an
invite, because that is the sequence the guide describes.

Minor, same area, found alongside: MCP `tools/list` advertises `create_invite`,
`list_invites` and `revoke_invite` to a token whose journal has contacts off.
The refusal on call is clear, so this is cosmetic — but a capability-filtered
tool list would be more honest.

## Acceptance

- A journal created through `POST /api/v1/journals` can issue a guest link and
  a buddy link without anybody touching the server.
- Whatever the mechanism, it is in `agent.md` next to the invite documentation.
- `/api/health` still reports the server-level switch as the outer gate.
- B33's remaining acceptance bullets become checkable on a journal an agent
  made — which is the real test that this is fixed.

---
id: B153
title: A journal created through the API can never invite anybody, because contacts is off and nothing can turn it on
type: ISSUE
priority: high
complexity: low
area: contacts, journals, api
found: "2026-09-03"
started: "2026-09-03T19:42:15Z"
merged: "2026-09-03T19:48:49Z"
completed: "2026-09-04T06:18:50Z"
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

## What was built — option 1, and why not option 2

`createJournal` now writes `contacts: { enabled: true }` alongside the other
three (`lib/journals.ts`). The comment already sitting above `auth` — "On, or
the owner could never get a token to write to what they just made" — is the
identical argument, and this task is the evidence for it.

Checked before flipping it, because it is the one real risk: **does contacts-on
advertise a way into somebody's journal?** It does not. B37 removed the open
request form, and the invite controls render inside `{viewer.owner && …}` at
`app/[user]/me/MePageContent.tsx:168`. The server's own `features.contacts` is
still the outer gate and stays off until an operator sets
`CONTACTS_ENCRYPTION_KEY` and a `DATABASE_URL` — a journal opting in above the
ceiling gets nothing, which is asserted directly.

**Option 2 was not built**, and the reason is in the task already: no
per-journal feature can be changed after creation, for any capability. That is
a bigger problem than contacts and it is now **B182**, which also records that
this fix does nothing for the journals that already exist — `sevi`, `sevi2`,
`test1` and `xydhd-qa1` through `qa5` are still contacts-off with no way in but
SSH.

The `tools/list` note at the end of this task is **B183**.

### Why the fixture hid it

Worth recording, because it is the interesting part. `test/invite-links.test.ts`
verifies all of B33 — and builds its journal with a `writeJournal` helper that
writes `contacts: { enabled: true }` into config.json by hand. The fixture had
the feature the product did not, so the whole feature could be green while
being unreachable for every journal an agent could create. Both new tests go
through `createJournal` for that reason.

## Acceptance

- A journal created through `POST /api/v1/journals` can issue a guest link and
  a buddy link without anybody touching the server.
  **Met** — `test/invite-links.test.ts`, "both link kinds, with nobody touching
  the server": creates the journal with `createJournal`, creates a trip, mints
  the owner's token, and posts to the real `/api/v1/<user>/invites` route for
  both kinds. Against the old code it fails with `expected 404 to be 201` —
  the exact response this task was filed for.
- Whatever the mechanism, it is in `agent.md` next to the invite documentation.
  **Not applicable as written.** The mechanism turned out to be a default, not
  a call, so there is nothing for an agent to do differently and nothing to
  document — the invite endpoints already work as `agent.md` describes them.
  If B182 adds a way to toggle features, that is what needs documenting.
- `/api/health` still reports the server-level switch as the outer gate.
  **Met** — "but the journal's opt-in cannot switch on what the server does not
  offer" asserts `isEnabled("contacts", …)` is false on an instance whose
  server config has no contacts block, which is the same resolution
  `/api/health` reports from.
- B33's remaining acceptance bullets become checkable on a journal an agent
  made.
  **Met for new journals.** Not for the eight that already exist on
  fernscout.ch — see B182.

Verified with all four: `npx tsc --noEmit`, `npx eslint .` (0 errors),
`npx vitest run` (1828 passed, 2 skipped), `npm run build`.

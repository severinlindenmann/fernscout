---
id: B182
title: A journal's features cannot be changed after it is created, so every journal made before today is stuck as it was
type: ISSUE
priority: medium
complexity: medium
area: config, api, capabilities
found: "2026-09-03T19:46:29Z"
---

# B182 — A journal's features cannot be changed after it is created, so every journal made before today is stuck as it was

## Why

Found while building B153. That task fixed the default — `createJournal` now
writes `contacts: { enabled: true }` alongside `reactions`, `costs` and `auth`
— but it only helps journals created **after** it merges. The finding
underneath it is untouched and is the broader problem:

> A grep over `app/` and `lib/` finds **no endpoint, no MCP tool and no page
> that writes a user's `features` block.**

So a journal's capabilities are decided once, at creation, by whatever
`createJournal` happened to write that day, and are then frozen. The only way
to change one is to hand-edit `content/<user>/config.json` over SSH.

On fernscout.ch today that leaves `sevi`, `sevi2`, `test1` and `xydhd-qa1`
through `qa5` with contacts off and no way to turn it on — which is the state
B153 describes, still true for every journal that already exists. It is also
why the QA journals cannot be used to verify B33, B37, B41, B52, B68, B74, B79
or B80 without server access.

It is not only contacts. `mail`, `signup`, `push`, `postcards` and `photobook`
are all per-journal opt-ins under a server ceiling (`resolveOne`,
`lib/capabilities.ts:103`), and none of them can be opted into after the fact.

## Work

Option 2 from B153, which that task deliberately did not take: a way to change
the per-journal half of a capability the server already allows. Probably a
`PATCH` on the journal's own config, owner-only.

The parts that need deciding:

- **Which fields.** The `features` block only, or the rest of config.json —
  title, tagline, locales, currencies — which has the same problem and is a
  bigger surface.
- **The ceiling still holds.** A journal must never be able to switch on
  something the server has not configured; `resolveOne` already refuses this,
  so the endpoint should not re-implement the check, it should rely on it.
- **What it must not touch.** `owner.email` is the credential that decides who
  can get a token for the journal (decision 24). Whether a PATCH may change it
  is a security question, not a config question — the safe answer is no, and
  the reasoning belongs in the code.

Not in scope: a settings page. There is no editing interface and there will not
be one (decision 24).

## Acceptance

- An owner can switch a capability on for their own journal, through a call, on
  an instance whose server config allows it.
- A journal cannot switch on a capability the server has not configured — the
  attempt is refused and says why.
- `owner.email` is not writable through it, and there is a test that says so.
- The existing journals on fernscout.ch can be brought to contacts-on without
  SSH, which is the real test that this is fixed.

---
id: B182
title: A journal's features cannot be changed after it is created, so every journal made before today is stuck as it was
type: ISSUE
priority: medium
complexity: medium
area: config, api, capabilities
found: "2026-09-03T19:46:29Z"
started: "2026-09-04T06:22:44Z"
merged: "2026-09-04T06:50:22Z"
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

## Built (2026-09-04)

Option 2, as the Work section describes it, with the three decisions made.

**Which fields: `features` only.** `setJournalFeatures` in `lib/journals.ts`
takes a map of capability name to boolean and writes nothing else. The rest of
`config.json` — title, tagline, locales, currencies, `media`, the journal's own
`visibility` — has the same problem and is a wider surface with different
questions in it, so it is captured as **B220** rather than absorbed here.

**The ceiling holds, and it refuses rather than complying uselessly.** The check
is `resolveCapabilities()[name]` with no username, which *is* `resolveOne`'s
server half — not a second implementation. A journal asking for something the
server has not configured is refused with `capability_unavailable` and the
server's own reason ("not enabled on this server", or the missing environment
variable by name), and nothing is written. That matters because the write would
otherwise be *inert*: `resolveOne` checks the server first, so `"contacts":
{"enabled": true}` under a server with contacts off changes nothing at all, and
a config file claiming a capability the journal does not have is a file that
lies to the next person who reads it. Switching a capability **off** is always
allowed, whatever the server says — a journal narrowing itself asks nobody, and
`features.mail: false` is a mute button somebody must always be able to press
(B60).

**`owner.email` is not writable.** The endpoint refuses the whole body when it
names any field but `features`, rather than ignoring the extra: a caller that
tried is told, and cannot smuggle a change past by attaching one that is
accepted. The reasoning is in the code — that address decides who can obtain a
token for the journal (decision 24), and a token must not be able to move the
boundary that issued it. `test/journal-features.test.ts` asserts the refusal and
that the file is byte-identical afterwards.

Two doors, because a REST-only fix would recreate the gap B175 and B206 exist
about: `PATCH /api/v1/<user>/config` (with a `GET` beside it, so a journal can
be asked what it currently wants) and MCP `set_journal_features`. Both are owner
only and agent-scope only — a trip-scoped token writes days and does not decide
what the journal can do. Documented in `/agent.md`, `/openapi.json` and
`docs/providers/mcp.md`.

The file is **edited, not regenerated**: the raw JSON is parsed, one `enabled`
flag is set inside each named feature, and everything else survives — a
hand-chosen `transport`, and keys this version has never heard of. It is read
back through `getUser` before success is reported, and the previous bytes are
restored if it does not parse, because a config file that will not load takes
the whole journal off the site (B204, one file over).

Not in scope, as stated: a settings page. There is no editing interface and
there will not be one (decision 24).

The last acceptance line — bringing the existing journals on fernscout.ch to
contacts-on without SSH — is a live check rather than a test, and is what to try
first when verifying this.

---
id: B104
title: Signup is on at the server and off in every journal, so no account has ever been created on the live site
type: OPS
priority: medium
complexity: medium
area: signup, ops, capabilities
found: "2026-09-03"
related: B102, B103, B105, B106, B107, B108, B109, B110
completed: "2026-09-07T13:43:07Z"
---

# B104 — Signup is on at the server and off in every journal, so no account has ever been created on the live site

## Why

**Partly stale as of 2026-09-05**: the server switch is still on
(`signup: {"enabled": true}`), but the per-journal half of the evidence below
can no longer be re-read from outside — B473 stopped `/api/health` naming
journals and their capability posture. Whether any journal has signup on has
to be checked on the server itself now, not from the endpoint this was
written against.

`/api/health` reports `signup` enabled at the server and disabled in every
single journal — `not enabled by example`, `by sevi`, `by sevi2`, `by test1`.
The route that turns a stranger into the owner of a journal
(`app/api/auth/signup/request`, `/verify`, `POST /api/v1/journals`) has
therefore never run on the live site, and it is the one path where the person
on the other end has no context, no folder, and nobody to ask.

Four filed tasks are what a first real signup walks straight into: B32 (a
taken username answers 409 with no route onward for somebody who already owns
it), B92 (one address may own three journals, and deleting one does not give
the name back), B55 (the signup token is documented single-use and is not),
and B75/B76 (a brand-new owner with no trips is told to ask whoever sent them
here for an invitation, and shown four zeroes). Every one of those is invisible
until somebody who is not already an owner tries it.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

Enable signup for the journal level the flow needs — check `lib/capabilities.ts`
and the per-user config for which switch actually gates it — then go through it
as a stranger, with an address that owns nothing here:

- sign up, pick a username, land in the new journal, and look hard at what an
  empty journal shows a person who has just arrived (B75, B76);
- try a username that is already taken (B32);
- try the same address a second time (B92);
- try re-using the signup token after it has been redeemed (B55).

Then clean up through the documented path rather than by hand:
`DELETE /api/v1/<user>` answers `202` and mails a single-use link to a page
with a button, and only the button deletes (`lib/deletions.ts`). That exercises
B38 and the tombstone at the same time — check afterwards that the old URLs
answer `410` and the name stays reserved.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- A signup completed on fernscout.ch by an address that was not already an
  owner, with what each step showed recorded.
- B32, B55, B75, B76 and B92 each confirmed or contradicted.
- One backlog task per new defect, referencing B104.
- The test journal deleted through the mail-gated flow, its URLs answering
  `410`, and its name shown still reserved.

## Reiterated and closed 2026-09-07

**The premise was wrong, and the owner was right to say so.** There is no
per-journal signup switch, and there could not usefully be one: signup is what
*creates* a journal, so at the moment it runs there is no journal whose config
could have gated it.

Confirmed in code — every call site asks the server-wide question and none
takes a username:

```
app/api/auth/signup/request/route.ts:24   isEnabled("signup")
app/api/auth/signup/verify/route.ts:15    isEnabled("signup")
app/api/v1/journals/route.ts:51           isEnabled("signup")
app/agent/page.tsx:70                     isEnabled("signup")
```

`lib/capabilities.ts:29` declares it as `{ env: ["SESSION_SECRET"], db: true }`
— an instance-level requirement, with no per-user field.

What produced the original reading was the old `/api/health`, which printed a
per-journal capability posture for *every* capability including ones that have
no per-journal meaning, so `signup` appeared as "not enabled by example, by
sevi…". That output is gone since B473. The line was noise, not a finding.

**Checked live the same day:**

```
POST /api/auth/signup/request  →  202  "POST /api/auth/signup/verify …"
POST /api/v1/journals          →  401  missing_token, "Start at POST /api/auth/signup/request."
```

Signup is on, reachable, and answering — not switched off anywhere.

**The one work item this ticket had is therefore void**: there is nothing to
"enable for the journal level the flow needs". Open signup is also a decision
the owner has now taken deliberately — fernscout.ch is a public service and
stays open (see B276).

What was genuinely worth doing here — walking the flow as a stranger and
checking the five edge cases — belongs to the tickets that already own each
one: **B32** (taken username), **B55** (signup token re-use), **B92** (one
address, three journals), **B75/B76** (what an empty new journal shows). They
stand on their own and do not need this ticket as a wrapper.

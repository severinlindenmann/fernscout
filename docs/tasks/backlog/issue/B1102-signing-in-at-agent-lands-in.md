---
id: B1102
title: Signing in at /agent lands in the six-step wizard, not the room B984 made the whole of it
type: ISSUE
priority: high
complexity: low
area: components/AgentDoor.tsx, app/agent/[user]
found: "2026-09-09T16:19:31Z"
---

# B1102 — Signing in at /agent lands in the six-step wizard, not the room B984 made the whole of it

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`app/agent/page.tsx:34` says it plainly: *"`/agent` — and it is the whole of it
now, B984. There were three pages ... **Signed in, this is the room.**"*

`components/AgentDoor.tsx:71` still says otherwise, in code:

```ts
function intoTheWizard(username: string) {
  router.push(`/agent/${encodeURIComponent(username)}`);
}
```

So B984 changed where a *returning* owner lands and left the sign-in redirect
pointing at the old six-step wizard. Somebody handed the URL `/agent`, who
signs in there, does not arrive in the room. They arrive at "Write a day, Step
1 of 6", with the journal's name back in the address bar — the two things B984
existed to remove.

Found while measuring tool choice on the live site: the agent signed in at
`/agent` and its first screenshot is `Step 5 of 6 · Preview`. It never saw the
conversation at all, so a run meant to test forty-three conversational tools
tested the wizard instead.

The comment above `intoTheWizard` still argues for itself on B688's grounds —
"the wizard for the first day, never a second stop to explain what a username
was". That argument was sound when the room was two clicks away behind a path
segment. It is not an argument for bypassing the room now that the room *is*
`/agent`.

## Work

Send a signed-in person to `/agent`, not `/agent/<user>` — the journal cookie
B984 added is what carries which journal, so the path segment is not needed to
know it.

Then decide what `/agent/<user>` is for, and that is the part worth thinking
about rather than deleting on sight: `app/agent/[user]/inbox` hangs off it, and
`AgentWizard.tsx:2147` links back to it. Either it stays as a deliberate second
door for the first day and something says so, or it goes and its inbox page
moves. Do not silently leave both.

Not doing: deleting `AgentWizard.tsx` in this ticket. That is a bigger
decision and it has a live caller.

## Acceptance

Sign in at `/agent` with an address that owns a journal. You land in the
conversation, and the address bar still reads `/agent`. Repeat for a brand-new
journal made through signup — that path is the one B688 was about, and it must
be checked separately.

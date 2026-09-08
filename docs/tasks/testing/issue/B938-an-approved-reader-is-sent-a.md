---
id: B938
title: An approved reader is sent a link that does not let her in
type: ISSUE
priority: medium
complexity: low
area: contacts, mail
found: "2026-09-08T09:29:13Z"
started: "2026-09-08T10:32:55Z"
merged: "2026-09-08T10:44:54Z"
---

# B938 — An approved reader is sent a link that does not let her in

## Why

`sendApprovedMail` (`lib/contacts/mail.ts:452`) builds the button that lets a
newly approved person in:

```ts
const openUrl = isEnabled("auth", username)
  ? signInUrl(baseUrl(), username, await issueStandingLink(username, contact.email))
  : `${baseUrl()}/${username}`;
```

With `auth` off, the mail says *"you can read it now"* and links to the
journal's front page — where she meets the sign-in gate, because reading a
`guest` trip needs a session and sessions are what `auth` is.

The mail is the **only** one she gets about being approved, so there is no
later correction. She was told yes, handed a door, and the door is locked.

The deeper fault is the one the fallback is papering over: `contacts` does not
declare that it needs `auth`, so an operator can switch on an approval queue
whose approvals cannot grant anything. `lib/capabilities.ts:44` — the
requirement is `env` and `db` only. Every grant made in that state is a promise
the instance cannot keep, and nothing anywhere says so.

`helper` already has the shape for this: `needs: { credits: … }`, B724, which
refuses to come on and says which switch to throw. AGENTS.md's rule is that an
optional capability must be *absent* rather than broken when it cannot work.

## Work

Give `contacts` a `needs: { auth: … }`. The capability then refuses to come on
without sessions, `/api/health` says which switch, and the fallback branch
becomes unreachable — so it goes, rather than being made to send a better
wrong link.

Check what else assumes it: `/<user>/contacts`, the invite routes, and the
helper's `invite_guest` all become absent together, which is the intended
behaviour and worth asserting.

Not doing: making a guest link work without sessions. There is no such thing.

## Acceptance

A test that turns `auth` off with `contacts` on and finds `contacts` off, with
a reason naming `auth`. And one that fails if `sendApprovedMail` can ever
produce a URL that is not a sign-in link.

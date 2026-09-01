---
id: B27
title: The welcome mail's link opens the public view, so the owner cannot see their own drafts
type: FEATURE
priority: medium
complexity: medium
area: mail, auth, journals
found: "2026-09-01"
---

# B27 — The welcome mail's link opens the public view, so the owner cannot see their own drafts

## Why

`sendWelcome` in `lib/journals.ts` puts a bare `${site.url}/${username}` behind
its "Open your journal" button. Following it makes the owner an anonymous
reader of their own site: private trips are gated, and drafts are filtered out
of every reading path by `getAllEntries`.

That is exactly backwards for the moment it happens in. The mail arrives
*because* an agent has just created the journal, and what an agent creates is
drafts and — by default — private trips. So the first thing the owner is
invited to do is open a page that shows them none of the work that prompted the
mail. The letter goes on to say "you can see what is waiting at any time" and
then hands them a link that cannot.

The machinery already exists. `issueCode(owner, email, "guest")` mints a
`linkToken`, `signInUrl()` builds the URL, and `verifyLink` in `lib/auth`
redeems it; `/[user]/i/[token]` is the route. It is what a guest invitation
already uses. The owner's own view — `isOwner()` in `lib/contacts/session.ts` —
is what makes drafts visible once a session exists.

Related to B20 (the stranger's `me` page never says who to ask) and B10, which
are about the same signed-in surface from the reader's side.

## Work

- Issue a guest link token for the owner's address as part of journal creation
  and put it behind the button, so one tap gives them a session that sees their
  own private trips and drafts.
- Keep the plain journal URL in the letter as well, in text. A link token is
  single-use and expires; a mail whose only address is a spent token is a mail
  that becomes useless, and this one is explicitly "the only mail that carries
  its address".
- Say what the button does, in one line. A link that silently signs somebody in
  is a link they should be told about before they forward the mail to anyone.

**Lifetime — decided by the author: the welcome link does not expire.**

The reasoning given was that the link is far more than six digits, so it does
not need the six-digit code's short window. That is true about *guessing* — the
token is 256 bits and there is nothing to brute-force.

It is worth writing down that guessing was never the reason the link was
short-lived. `005-signin-link.ts` says the opposite, and it is right:

> The link travels in a URL: it is prefetched by mail scanners, copied into
> chat windows, and written to browser history. So the link is the weaker of
> the two.

Exposure, not entropy. A permanent link is one that stays live in an inbox, in
whatever scanner logs it touched, and in browser history, indefinitely.

What makes the decision safe anyway is **single use**, which already exists and
must not be given up: the first fetch consumes the link, so a permanent link is
self-limiting rather than indefinitely replayable. In practice a mail scanner
that prefetches will burn it and the owner falls back to the code — which is
exactly what the two-credential design was built for, and why redeeming the
link must go on consuming only itself.

So: permanent, single-use, and the mail says what the button does so nobody
forwards it thinking it is just an address.

**Scope — unchanged.** A guest session is not an agent token and must not
become one; decision 24 is that reading the site on your phone must not put a
credential that can rewrite it in your pocket. What is issued here stays on the
guest side of `resolveSession`.

**One interaction to handle.** `issueCode` calls `revokeCodes` for the same
owner, address and kind, which sets `consumed_at` — and `verifyLink` requires
`consumed_at is null`. So as things stand, the first time the owner asks for
any guest code, the permanent welcome link dies. That makes "permanent"
untrue in the case that matters most. Whatever shape the fix takes, the welcome
link has to survive an ordinary sign-in code being issued.

Not doing: an owner-specific session class. If the guest session plus
`isOwner()` is not enough to show drafts, that is a finding to write up, not to
fix inside this task.

## Acceptance

- Creating a journal writes a `.eml` whose button URL redeems to a session.
- Opening that URL and then visiting `/<user>` shows the trips an anonymous
  visitor cannot see, and the drafts.
- The plain `/<user>` address still appears in the letter as text.
- The token is a guest session: presenting it as a bearer token to any
  `/api/v1/…` write is refused, and a test asserts that.

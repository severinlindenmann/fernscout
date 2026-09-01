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

Open questions for whoever takes this, both worth deciding before writing code:

- **Lifetime.** Guest link tokens are short-lived by design. This one is the
  owner's first way in and may be opened days later. Either it gets a longer
  life than a guest invitation — and then it is a different kind of credential
  and should be named one — or the mail says plainly that it expires and how to
  get another.
- **Scope.** A guest session is not an agent token and must not become one;
  decision 24 is that reading the site on your phone must not put a credential
  that can rewrite it in your pocket. Whatever is issued here stays on the
  guest side of `resolveSession`.

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

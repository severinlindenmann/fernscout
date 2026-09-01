---
id: B55
title: A signup token is documented as single-use and is not
type: SECURITY
priority: medium
complexity: low
area: auth, signup, journals
found: "2026-09-01"
started: "2026-09-01"
---

# B55 — A signup token is documented as single-use and is not

## Why

The mail that carries a signup code says, in as many words:

> Somebody — probably an agent working for you — asked to create a travel
> journal at this address. Give it this code and **it can create one journal,
> once.**

It cannot create one journal once. `app/api/v1/journals/route.ts` resolves the
signup session, creates the journal, and never revokes it. The session's own
TTL is twenty minutes (`SESSION_TTL_MS.signup`), so the same token creates
journals until either that expires or `MAX_JOURNALS_PER_EMAIL` (3) is reached.

Found while testing the live flow: after creating `alpenweg`, the same signup
token was still accepted on a second `POST /api/v1/journals` — the call was
refused because the *name* was taken, not because the credential was spent.

The blast radius is genuinely small: three journals, capped by address, and the
holder is whoever was given the code. What makes it worth fixing rather than
re-documenting is the sentence it breaks. "Once" is the word that makes a
person comfortable pasting a code into an agent's chat window, and it is the
kind of promise that should be true because it says it is, not because nobody
has tested it. The same mail is also the one place a non-technical owner is
told what they are handing over.

`agent.md` is vaguer ("a token which can do exactly one thing") and survives
either reading; the mail does not.

## Work

- Revoke the signup session as soon as the journal is written —
  `revokeSession` already exists and is what `listSessions`/`revokeSession`
  use. Do it after `createJournal` succeeds, never before: a token burned on a
  refused request would strand somebody on a taken username with a dead
  credential and no way back but another code.
- Decide what a reuse then answers. `401 invalid_token` is honest and matches
  an expired one; a distinct body saying "this token has already created a
  journal — ask for a new code" is kinder and tells an agent it did not
  imagine the first success.
- If the answer is instead "three is fine, fix the mail", that is a legitimate
  outcome — but then the mail has to say three, and the cap has to be the thing
  it names.

## Acceptance

- A signup token that has created a journal is refused on a second
  `POST /api/v1/journals`, with a message that says why.
- A signup token whose journal creation was *refused* (bad username, taken
  name) still works, so a correctable mistake does not cost a round trip
  through email.
- A test covers both, because the difference between them is the whole care in
  this change.
- No mail, document or schema still says "once" if the decision goes the other
  way.

---
id: B931
title: The helper says a person can read a trip when they have no access at all
type: ISSUE
priority: high
complexity: medium
area: agent, contacts
found: "2026-09-08T08:36:52Z"
started: "2026-09-08T08:37:28Z"
merged: "2026-09-08T09:00:10Z"
completed: "2026-09-09T16:47:20Z"
---

# B931 — The helper says a person can read a trip when they have no access at all

## Why

A 71-year-old, on the third attempt, finally published a day by talking. The
one thing she wanted it for was her daughter. She said:

> "nur meine Tochter soll das lesen können"

The helper proposed `visibility: private` and told her, verbatim:

> **"Die Reise ist auf privat gesetzt – nur Sie und Ihre Tochter können sie
> sehen."**

Verified on the live instance: `people: []`, `invites: []`. **Nobody was ever
asked for her daughter's name or address, and no invite was ever offered.** Her
daughter has exactly the access she would have had if she had never been
mentioned — none.

The trip is correctly closed to strangers. It is also closed to the person it
was made for, and its owner was told the opposite.

Her verdict: *"I don't trust a 'private, just for family' button that doesn't
actually put family on the list."*

**Why B923 did not catch this.** That ticket fixed the visibility field's
*labels* and the tool's description, and the labels are now right. Nothing
checks what the model **says about access** in its prose. It is B920's failure
in a third territory: first "saved", then "there is a button", now "she can
read it".

This is the worst of the three, because the product exists so that somebody's
family can read their journal. A false claim here is not a wasted tap; it is
the whole purpose quietly not happening.

## Work

Two halves, and both are needed.

**Stop the claim.** Extend the honesty check to access: a turn that says a named
person, or "your family", can read something must carry the thing that would
make it true — a `guest` invite proposal — or it is caught and replaced, exactly
as a phantom button now is. The server knows `people` and `invites`; the claim
is checkable.

**Make it possible.** Naming a person is a request the helper cannot currently
fulfil at all: there is no invite tool in the conversation. `invite_guest` is in
the inventory's list and unbuilt. Until it exists, the honest answer is the one
she proposed herself:

> "private means only the people who were with you on the trip; to let your
> daughter in without her having been there, this has to be *guest*, and she
> needs an invitation — shall I make you a link to send her?"

And then offer it. A guest link belongs in a family chat; a buddy link does not,
and only the guest one belongs here.

## Acceptance

Naming somebody who should read a trip either invites them or says plainly that
they have not been invited yet. Nothing ever says a person can read something
they cannot.

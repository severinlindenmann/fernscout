---
id: B20
title: The stranger's me page never says who to ask
type: ISSUE
priority: medium
complexity: low
area: me, contacts
found: "2026-09-01"
started: "2026-09-04T07:30:32Z"
merged: "2026-09-04T07:57:03Z"
---

# B20 — "Ask them" — ask whom?

## Why

`/example/me` for a reader with no session is the page written for the least
technical person on the site. Its docblock
(`app/[user]/me/MePageContent.tsx:14–24`) names her: the grandmother who opens
the journal once a month from a link in an email and, when she loses the
email, has no way back in.

When the journal keeps no guestbook and issues no codes — which is the demo
journal's configuration, `contacts` and `auth` both `false` in
`content/config.json` — she is shown `me.askOwner`
(`app/[user]/me/MePageContent.tsx:95`):

> There is nothing to fill in here — this journal keeps no guestbook. The link
> they send you is what lets you in.

"They" is never named. The page has just told her that the only way in is to
ask a person, and does not say which person, on a site she may have reached
without knowing whose it is (see B10 — no page names the author either).

The name is right there and already loaded. `MePage` calls `getUser(user)` at
`app/[user]/me/page.tsx:26`, and `content/example/config.json` carries:

```json
"owner": { "name": "Alex Berger", "nickname": "Alex", "email": "agent@fernscout.ch" }
```

`nickname` is exactly the short form this needs. It is not passed to the
component.

## Work

Pass the owner's display name — `nickname` falling back to the first word of
`name` — and the username into the stranger's branch, and say who to ask:
"Ask Alex — this is Alex's journal, at /example."

The line that must not be crossed: **no email address, no postal address, no
phone number**. `owner.email` is in the same object and must not travel to the
client. Pick the fields explicitly at the server boundary in
`app/[user]/me/page.tsx` rather than passing the config object and choosing in
the component — a later edit to the component should not be able to leak a
field it was never meant to have.

The copy is three locale files (`content/locales/{en,de,hu}.json`) plus the key
in `lib/i18n.ts`, and it interpolates a name — check the placeholder style used
by `cost.unconverted`, which already does this.

Consider whether `me.strangerBody` should carry the name too, so the journal
introduces itself before it explains the doors. That is a copy decision, not a
code one.

## Acceptance

- `/example/me` with no session names Alex without naming an address.
- `agent@fernscout.ch` does not appear anywhere in that page's HTML or its RSC
  payload — assert it, since the value is one property away from being passed.
- A journal whose owner has no `nickname` gets a sensible short name rather
  than a blank or a full "Firstname Lastname" where a first name was meant.
- `npm run i18n:keys` passes.

## What was built

`ownerShortName(user)` in `lib/site.ts` — the nickname, falling back to the
first word of `name`, and `undefined` when the config names nobody.
`app/[user]/me/page.tsx` calls it and passes the **string** down as `ownerName`;
`journal.owner` never leaves the server, which is the line the Why draws.

The stranger's branch of `MePageContent` now names that person in **both** of
its sentences, with the unnamed originals kept as the fallback for a journal
whose config has no owner name:

- `me.strangerBodyNamed` — "This journal is kept by {name}. If somebody sent you
  a link to it, follow it. To be added properly, ask {name} to invite you."
- `me.askOwnerNamed` — "There is nothing to fill in here — this journal keeps no
  guestbook. It is kept by {name}: the link {name} sends you is what lets you
  in."

Three locale files plus `npm run i18n:keys`.

**One correction to the Why:** `me.askOwner` is shown when `canSignIn` is false
— that is, when **auth** is off — not when contacts and auth are both off. The
observation still held for the demo journal, which has both off, but the branch
a stranger lands in on a journal with auth *on* was the more common one and was
equally anonymous, which is why the name is in `strangerBody` too rather than
only in the sentence the Why quotes. That was left open as "a copy decision";
this is the decision.

The name and nothing else, per B117's discipline: the page says who to write to
without saying anything a stranger could not already see. No address, no phone
number, and nothing about what trips exist.

## Evidence

`/alex/me` on a dev server, no session, **auth on**:

> You are not signed in. This journal is kept by Robin. If somebody sent you a
> link to it, follow it. To be added properly, ask Robin to invite you.

the same page with **auth off**, where the sign-in form is absent:

> … There is nothing to fill in here — this journal keeps no guestbook. It is
> kept by Robin: the link Robin sends you is what lets you in.

`owner@example.test` appears nowhere in either response — asserted on the served
HTML including its RSC payload, and again in
`test/access-panel.test.tsx` and `test/access-panel-capability.test.ts`, which
now also assert that the page hands down a name and never the object it came
from. `test/site-travellers.test.ts` covers the nickname, the first-word
fallback and the nameless config.

`npm run i18n:keys`, `npm run build`, `npx tsc --noEmit`, `npx eslint .` (0
errors), `npx vitest run` (130 files, 2098 passed).

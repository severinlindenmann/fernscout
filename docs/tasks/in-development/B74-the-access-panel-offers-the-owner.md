---
id: B74
title: The access panel offers the owner a contacts page the journal has switched off
type: ISSUE
priority: medium
complexity: low
area: me, contacts, capabilities
found: "2026-09-01"
started: "2026-09-01"
---

# B74 — The access panel offers the owner a contacts page the journal has switched off

## Why

Found on 2026-09-01, signed in as the owner of a new journal. `/<user>/me`
shows the owner block, and the last thing in it is a link reading *"Verwalten,
wer mitlesen darf"*. Following it gives the 404 page.

The link is rendered on ownership alone
(`app/[user]/me/MePageContent.tsx:142, 179–184`):

```tsx
{viewer.owner && (
  …
  <Link href={`${site.base}/contacts`}>{t("me.contacts")}</Link>
)}
```

The page it points at refuses on two grounds
(`app/[user]/contacts/page.tsx:34`):

```ts
if (!user || !isEnabled("contacts", username)) notFound();
```

The owner exists, so the failing half is the capability. That page is careful
about the *other* refusal — when the viewer is not the owner it renders a
signed-out notice rather than a 404, with a docblock explaining that the owner
arriving from an email on a signed-out phone "needs to be told to sign in, not
shown a dead end" (`:27–29`). The capability arm gets no such treatment, and
the link that leads into it asks no such question.

The same file's server component already knows how to do this. `manageHref` is
resolved at `app/[user]/me/page.tsx:35` behind `isEnabled("contacts", user)`,
under a comment (`:48–53`) that names this exact mistake: *"a capability is a
server ceiling and a journal opt-in, and the page was offering a door that this
journal had never opened."* One door on the page was closed and the other was
left open.

AGENTS.md states the rule this breaks: an optional capability that is off must
be **absent** rather than broken. A 404 is the loudest possible way of being
broken, and it teaches the owner that their own journal is unreliable rather
than that a feature is switched off.

## Work

Gate the owner block's contacts link the way `manageHref` is already gated:
resolve `isEnabled("contacts", user)` in `app/[user]/me/page.tsx`, pass it in,
and render the link only when it holds. Resolving it server-side rather than in
the component is not incidental — `isEnabled` reads server config, and the
component is `"use client"`.

Worth checking while in there whether any other surface links to `/contacts`
ungated (the approval mail is the other known entry point, and it is only sent
when contacts is on).

Not in scope: what the panel should say instead when contacts is off. Nothing
is the right answer — the owner of a journal with the capability off has no
guest list to manage, and a disabled control explaining an operator-level
switch would be noise.

## Built

`app/[user]/me/page.tsx` now asks the question once — `const contactsEnabled =
isEnabled("contacts", user)` — and both doors on the page read the same answer:
`manageHref`, which already consulted it, and a new `contactsEnabled` prop.
`MePageContent` renders the owner's guest-list link only when it holds. The prop
is required rather than optional, so a page that forgets to answer is a type
error and not a silently missing link.

The owner block itself is untouched: the address, the email and the token
warning are what an owner comes to that page for and none of them depend on
contacts. Only the last link disappears — absent, not disabled, as the Work
section asked.

**The sweep for other ungated links to `/<user>/contacts`.** There is exactly
one other, and it is already safe: `lib/contacts/mail.ts:142` puts a button on
the owner's "somebody wants to read along" mail. That mail is sent only from
`notifyOwnerOfRequest`, whose one caller is `app/api/contacts/confirm/route.ts`,
which refuses at `:27` unless the capability is on — so the mail cannot exist on
a journal where the link would 404. Everything else matching `/contacts` is the
`/api/contacts/*` routes, and all four of those gate on `isEnabled("contacts",
…)` themselves. The page-level entry points (`/[user]/contacts`, `/[user]/c/…`,
`/[user]/i/…`, `/[user]/u/…`) each gate too. `app/[user]/me/MePageContent.tsx`
was the only unguarded one.

## Acceptance

- With `contacts` disabled for a journal, the owner's `/<user>/me` shows no
  link to `/<user>/contacts`.
- With it enabled, the link is present and the page it opens renders.
- A test covering both, alongside whatever already covers `manageHref`.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` pass.

The three new tests fail on the code as it stood: with `app/` reverted,
`test/access-panel.test.tsx` renders `<a href="/alex/contacts">` for an owner
whose journal has contacts off, and `contactsEnabled` arrives `undefined` from
the server component.

And the dev server was booted against a copy of `content/` with the capability
both ways, which is the other half of the second line — the page the link opens:

```
contacts on   GET /example/contacts 200   GET /example/me 200
contacts off  GET /example/contacts 404   GET /example/me 200
```

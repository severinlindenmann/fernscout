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

## Acceptance

- With `contacts` disabled for a journal, the owner's `/<user>/me` shows no
  link to `/<user>/contacts`.
- With it enabled, the link is present and the page it opens renders.
- A test covering both, alongside whatever already covers `manageHref`.

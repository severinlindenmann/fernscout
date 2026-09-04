---
id: B281
title: The invite panel asks who a link is for and then shows neither that nor the language, and offers a third link kind nobody needs
type: FEATURE
priority: medium
complexity: medium
area: contacts, invites, web, i18n
found: "2026-09-04T12:41:00Z"
started: "2026-09-04T13:11:35Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T13:11:35Z"
---

# B281 — The invite panel asks who a link is for and then shows neither that nor the language, and offers a third link kind nobody needs

## Why

The invite half of `/<user>/contacts` is three things at once and none of them
completely. As it renders today (German, `content/locales/de.json`):

```
Einladungslinks
  Neuer persönlicher Link
  Für wen ist er?  [____]
  Schreibt mir auf [Deutsch ▾]
  [Link erstellen]

  Ein Link zum Mitlesen
  0× benutzt · gültig bis 2026-10-04            [Sperren]
```

Three problems in that screenshot.

**The form only makes `personal` links.** `createInvite` defaults to it and
`toKind` falls back to it (`lib/contacts/invites.ts:92`), and it is the DB
column default (`lib/db/migrations/003-contacts.ts:77`). The other two kinds —
the `guest` link for readers and the `buddy` link for someone who writes to a
trip — are created on a different page entirely, by `components/InviteLinks.tsx`
on `/<user>/me`. So the page titled "Einladungslinks" cannot make the two links
an owner actually hands out, and the page that can is the one about the owner's
own access. B282 is the other half of this.

**The form asks a question the list then throws away.** "Für wen ist er?" fills
`Invite.name`, and the row renders kind, usage and expiry — not the name, not
the language. The owner types who it was for and is shown "Ein Link zum
Mitlesen · 0× benutzt". B97 already fixed the worse version of this (two
identical rows, one of which led to write access) by putting the *kind* on the
row; the name and language are still missing.

**Every send needs a new link,** because the token is stored hashed — that is
B280, which this task depends on for the copy action.

## Work

**One panel, on the contacts page, that makes and manages every kind of link.**

- **Drop `personal` from the UI.** Stop offering it; keep `toKind` and the
  redemption path so existing `/{user}/i/<token>` links keep working, and keep
  `INVITE_KIND_KEY`'s `personal` entry so old rows still render with a label
  rather than a blank. Removing the *kind* from the codebase is not in scope —
  rows exist.
- **The create form asks for a note, not a person.** Free text, the owner's own
  words — "Familie Meier", "Nachbarn", "Grund" in the label rather than "Für
  wen ist er?". It is stored in `Invite.name`, which needs no migration; only
  the copy changes, in all three locales. Plus the language select, which stays,
  and the kind: a reading link, or a writing link naming a trip.
- **The row shows the note, the language and the usage**, in that order — the
  note first, because it is the only thing that distinguishes two rows to the
  person deciding which to revoke. Keep the kind visible: B97's finding was that
  a reading link and a writing link must never look alike.
- **A copy action per row**, from B280. And a revoke, which exists.
- **Move `guest` and `buddy` creation here** from `components/InviteLinks.tsx`.
  Add it here; **B282 removes the `/me` mount and deletes the component**, in
  that order, so there is never a commit on `main` with no way to make a link.
  One place that issues links, or the two disagree about wording within a month —
  `INVITE_KIND_KEY` in `components/ContactsAdmin.tsx:87` already exists to keep
  the vocabulary shared with the `/me` panel, and after this there is only one
  panel to keep it shared with.
- **Say what each kind leads to, in words, next to the button.** The
  `me.inviteGuestBody` / `me.inviteBuddyTitle` strings already do this on `/me`
  and are what AGENTS.md asks for: a guest link belongs in a family group chat
  and a buddy link does not. Carry the strings over rather than writing a second
  set.

Not doing: per-trip guest links (a guest is a guest of the journal — that is
deliberate and stated in AGENTS.md), an expiry picker, and any change to what
redemption does.

## Acceptance

- `/<user>/contacts` creates a reading link and a writing link, and no longer
  offers a personal one.
- The create form asks for a note and a language; the row shows note, language,
  kind and usage, and a link created with a note shows that note.
- An invite created before this task still renders, with a label rather than a
  blank, and still redeems.
- Each row copies (B280) and revokes.
- All three locales carry the new strings; no English leaks into the German
  page.
- The four checks pass, and `claude-security` has been run over the branch.

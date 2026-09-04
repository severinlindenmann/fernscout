---
id: B281
title: The invite panel asks who a link is for and then shows neither that nor the language, and offers a third link kind nobody needs
type: FEATURE
priority: medium
complexity: medium
area: contacts, invites, web, i18n
found: "2026-09-04T12:41:00Z"
started: "2026-09-04T13:11:35Z"
merged: "2026-09-04T13:24:19Z"
completed: "2026-09-04T20:01:44Z"
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

**The form asks a question the list then throws away — and the reason is not
the list.** *Corrected while building; the capture had this wrong.* `InviteRow`
(`components/ContactsAdmin.tsx:597`) has rendered the note, the language, the
kind, the usage and the expiry since B97. The screenshot above shows none of
the first two because the link in it was made on `/me`, by
`components/InviteLinks.tsx`, which posts `{ kind: "guest" }` and collects
neither — B97's own doc comment says exactly this: "issued from the access
panel, which is how they are normally issued, neither carries a name or a
language".

So the two halves are one problem. **The form that collects a note makes the
wrong kind of link, and the form that makes the right kinds collects nothing.**
Every real link therefore has null in both columns and the list is one row
repeated, which is the state B97 was trying to get out of. Moving creation here
is what fills the columns that already exist.

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

## Verified

All four green: `npm run build` compiled, `npx tsc --noEmit` clean, `npx eslint .`
0 errors (4 pre-existing warnings, none in these files), `npx vitest run` 159
files / 2426 tests. `npm run unused` reports no unused files, dependencies or
unresolved imports.

`test/invite-panel.test.tsx`, twelve tests: both kinds offered with the sentence
saying what each leads to; no personal link; the note asked for and "who is it
for" gone; the reading link is the default and comes first, asserted on the
markup rather than on intent, because write access one un-read radio away is the
B97 mistake made earlier; the writing option refused with a reason on a journal
with no trip and offered normally with one; a live link with a recoverable token
copyable; a pre-B280 link, a revoked link and an expired link each offering no
copy control; the copy control not reciting the URL as its accessible name; and
an old `personal` row still rendering with a label rather than a blank.

**The change that made this small: the panel posts to `POST /api/v1/{user}/invites`
rather than growing its own validation.** `/api/contacts/admin`'s `invite` action
is deleted — it was the `personal`-link maker — because the v1 route already
refuses a writing link with no trip, a reading link *with* a trip, and a trip
that does not exist, and always dates the link. Two routes that both create
invites would be two sets of rules to keep in step, and `InviteLinks` on `/me`
was already calling the v1 one. Redemption of existing `personal` links is
untouched.

`/api/contacts/admin`'s GET now returns each link's `url` (from
`listInvitesWithLinks`), so the list still offers copy after a refresh. That
route is owner-only on the same `isOwner` guard, cookie or token, as it has
always been; `GET /api/v1/{user}/invites`, which an agent bearer token also
reaches, still carries no token. The cache-header question over a page that now
holds credentials is **B287**, captured during B280.

One design decision made while building, worth stating: the "no trip yet" case
says so **on the writing-link option itself** and refuses the radio, rather than
letting the owner select it and then explaining. A control you can pick that
then tells you it will not work is the dead-button shape this project's
capability rule exists to avoid.

Still open, and B282's: `components/InviteLinks.tsx` and its mount on `/me`.
This task deliberately leaves both in place so there is no commit on `main`
where a link cannot be made at all.

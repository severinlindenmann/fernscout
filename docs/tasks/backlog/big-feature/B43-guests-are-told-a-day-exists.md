---
id: B43
title: Guests are told a day exists in a batched list of links, and never sent the day itself
type: FEATURE
priority: medium
complexity: high
area: digest, contacts, mail, drafts, media
found: "2026-09-01"
---

# B43 — Guests are told a day exists in a batched list of links, and never sent the day itself

## Why

The one thing that reaches everybody today is the digest (`lib/digest/`, ROADMAP
D2). It is a batch: it runs on a schedule, waits for a decent hour
(`lib/digest/quiet.ts`), and sends a list of up to six lines — date, title,
location, link (`DigestDay`, `lib/digest/content.ts:27`). No prose, no
photograph. A reader in their seventies on a phone gets "3 new days in Vietnam"
and a link they must follow, on that device, to find out anything at all.

The ask is the opposite shape and a different channel: **at the moment a day
stops being a draft, the guests who chose it get that day** — its words, one
picture, and a link that opens the full entry already signed in. Not a
notification about content; the content, in the inbox, readable without
tapping anything.

Four things stand between here and there, and each is worth knowing before the
work is scoped.

**There is no publish event to hang it on.** A day is published by a person
deleting the line `status: draft` from a file in a text editor — that is B28's
entire subject, and B28 is in `open/` and unbuilt. Nothing in the codebase is
notified when that line disappears. The digest sidesteps this deliberately:
`lib/digest/content.ts:9` explains that "new" means the day's **date** is after
the reader's watermark, "not a `published_at` column that does not exist". This
task needs exactly the column that comment says does not exist. **It cannot be
built before B28 or something like it defines what publishing *is* as an
operation** — and a filesystem watcher on `content/` is not that, because the
same edit arrives from a git pull, a restore, and an editor's autosave.

**The picture will be broken for precisely the trips that matter.**
`app/[user]/media/[...path]/route.ts:44` gates every media file behind
`mayReadTrip`, which reads a session cookie, and refuses with a 404 that "tells
a prober nothing". A mail client fetching `<img src="https://…/media/…">` sends
no cookie. So a remote image works for a public trip and shows a broken box for
a `guest` or `private` one. On top of that `lib/mail/template.ts` has no image
block at all (`MailBlock` is paragraph, heading, button, item — `template.ts:16`),
`Mail` has no attachments (`lib/mail/types.ts:2`), and `lib/mail/rfc822.ts:29`
builds `multipart/alternative` only. Sending one photograph is not a template
tweak; it is a signed or one-time media URL, or `multipart/related` with a CID
part, and a decision about which.

**Mailing the content is a bigger promise than mailing a link.**
`lib/digest/visibility.ts` enforces one sentence — a digest never mentions a
trip the reader cannot open — and refuses password-gated trips outright, on the
grounds that a line about one would be "a link to a door the reader has no key
for". This mail carries the private thing *in the message body*, to an address,
through servers nobody here controls, where it stays in an inbox that gets
forwarded. The visibility rule does not merely carry over; it has to be
re-decided at the higher stake, and the honest default is that only trips a
reader holds a live `read` grant for are ever sent this way.

**"If selected" needs somewhere to live.** `ContactRecord` already has
`wantsEmailDigest` (`lib/contacts/index.ts:58`) and `wantsPostcard` beside it,
so the shape exists — but a reader must not receive both a full mail per day
and a digest line for the same day, and the interaction between the two is a
choice, not an implementation detail.

The authenticated link is the one part that is already solved and should not be
reinvented: `signInUrl()` (`lib/auth/index.ts:129`) plus the redemption route
`app/[user]/s/[token]/route.ts`, which is what B27 shipped for the welcome mail
and what B29 asks for generally. A guest opening it on a phone that has never
seen the journal lands signed in.

## Work

**Depends on B28.** Take that first, or take this only as far as the parts that
do not need a publish event. What follows assumes a publish operation exists and
can call something.

- **Fire on the transition, once.** The trigger is draft → published for one
  entry, and it must be idempotent and recorded: a day republished, re-saved, or
  restored from backup does not mail twice. `lib/digest/record.ts` already
  solves this shape (claim before send, so a crash loses at most one mail and
  never duplicates one) and the same table should carry these.
- **Choose the recipients narrowly.** Contacts with the new preference set,
  approved, confirmed, holding a live `read` grant covering that trip. Reuse
  `readGrantsByContact` (`lib/digest/visibility.ts:49`) rather than writing a
  second rule — note B35 and B41 are both in that file right now, so rebase on
  them rather than racing them.
- **Add the preference** as a sibling of `wantsEmailDigest`, with a migration
  defaulting it **off** for every existing contact, and settle the interaction:
  a day sent in full is marked as seen for that reader so the digest does not
  list it again.
- **Build the mail**: the entry's prose (trimmed to a readable length, with the
  full text behind the link), one photograph — the entry's `cover`, falling back
  to the first gallery item, and no mail at all if there is neither — and a
  single button carrying a sign-in link. Plain-text alternative, as every mail
  here has.
- **Solve the image honestly.** Either a signed, expiring media URL that
  `app/[user]/media/[...path]/route.ts` accepts without a cookie, or a CID
  attachment and `multipart/related` in `lib/mail/rfc822.ts`. Whichever, the
  mail must still be readable when the client blocks images —
  `lib/mail/template.ts:13` already commits to that.
- **Respect the existing courtesies**: quiet hours (`lib/digest/quiet.ts`),
  `List-Unsubscribe`, the reader's locale (`pickLocale`), and the `file`
  transport so the whole thing is testable with no account.

**Not doing:** a per-photo picker, multiple images, mailing drafts to anybody,
or notifying on edits to an already-published day. The trigger is the one
transition and nothing else.

## Acceptance

- Publishing a day mails every opted-in contact with a grant on that trip, and
  publishing it a second time mails nobody — asserted against the record table,
  not by inspecting the outbox once.
- A contact without the preference, or without a grant, gets nothing; a
  password-gated trip mails nobody at all.
- The mail contains the day's prose, one image that renders in a client with no
  session cookie, and a button that signs a guest in on a browser holding no
  cookie and lands them on the day — verified end to end against the `file`
  transport and a fresh browser context.
- With images blocked, the mail is still readable and the link still works.
- A day sent in full is not listed again in that reader's next digest.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` and `npm run build` all
  pass, and the dev server boots with `contacts` and `mail` both on and off.

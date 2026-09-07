---
id: B798
title: A reader must copy a code by hand before a magic link she gets anyway
type: FEATURE
priority: high
complexity: low
area: contacts, auth
found: "2026-09-07T14:58:56Z"
started: "2026-09-07T15:09:33Z"
merged: "2026-09-07T15:30:06Z"
---

# B798 — A reader must copy a code by hand before a magic link she gets anyway

## Why

Played for real on the live instance, 2026-09-07, with a 66-year-old character
following one WhatsApp link:

1. tap the link → a form: name, email (plus optional phone and postal address)
2. **leave the browser, open the mail app, find a six-digit code, come back,
   type it into a second form**
3. "You're in the queue"
4. wait for a second mail
5. tap the link in *that* mail — which is a one-click sign-in, no code

**Two forms, two mails, two app-switches, and a code typed by hand — before a
step that proves the magic-link pattern already exists in this flow.** The
approval mail does the very thing the join confirmation makes her do manually.

The most likely place she rings her daughter is step 2: transcribing six digits
between two apps with the browser tab still open behind her.

Reading somebody's journal is why the journal exists. This is the path every
reader takes, and it is the longest one in the product.

## Work

Use the same one-click link for the join confirmation that the approval mail
already uses. Her flow becomes: type name and email, tap one link in one mail.
No code, no second form, no transcription.

Keep the code path as a fallback — a link that a mail client mangles is a real
failure, and the code is what rescues it.

Check `lib/contacts/` for how the approval link is minted and whether the same
mechanism can carry a confirmation.

## Acceptance

A reader with one invite link reaches "you're in the queue" without typing
anything but their name and address.

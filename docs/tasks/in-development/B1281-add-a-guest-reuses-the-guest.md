---
id: B1281
title: Add a guest reuses the guest's own form, so the owner is asked for Your name and Write to me in
type: ISSUE
priority: medium
complexity: low
area: contacts
found: "2026-09-10T10:38:00Z"
started: "2026-09-11T13:21:53Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T13:21:53Z"
---

# B1281 — Add a guest reuses the guest's own form, so the owner is asked for Your name and Write to me in

## Why

`/<user>/contacts` → **Add a guest**, which is the owner entering somebody
else's details. The form asks:

> **Your name**
> **Your email address**
> **Write to me in** — English
> Phone number (optional) — *for postcards, and for WhatsApp updates if **they**
> have asked for them*
> Postal address — *only if **they'd** like a real postcard in the mail*
> Name on the envelope · Street and number · Postcode · Town · Country
> ☐ Wants an email when there are new days to read
> ☐ Wants a real postcard from the road

The labels are the guest's own self-description form — `contact.name` ("Your
name"), `contact.email` ("Your email address"), `contact.language` ("Write to me
in") — reused unchanged for the owner filling it in on somebody's behalf. The
*hints* underneath were rewritten for the owner ("if **they** have asked",
"only if **they'd** like"), so the same field reads as second person in the label
and third person in the help text, three lines apart.

"Write to me in" is the worst of them: on this form it means *the language the
invitation email to this guest is written in*, and it reads as *the language
this person should write to me in*.

The checkboxes are correct already ("Wants an email…"), which is a good model
for the rest.

## Work

- Give the owner-facing form its own labels. The keys are shared with the guest's
  own form, so this is new keys in all three locales plus `npm run i18n:keys`,
  not an edit in place — real German and Hungarian, per AGENTS.md.
- Check the guest's own form still reads correctly afterwards.

## Acceptance

- Adding a guest asks for their name, their email address, and which language to
  write to them in.
- No field on the form addresses the reader as the person being added.

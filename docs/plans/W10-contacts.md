# W10 — Contacts, invites, guest approval

**Roadmap:** C4–C7, C9–C16, decision 19 · **Depends on:** W06, W07, W08 · **Wave F**

## Goal
One record per person. It carries their language, their channels, their access,
and — if they want a postcard — their address. Everything downstream reads it.

## The model (ROADMAP §3.1)
```
contact
  name, email (identity key), preferred_locale
  postal: name, line1, line2, postcode, city, country   -- optional, ENCRYPTED
  wants_email_digest, wants_postcard
  access grants (trip, level), push subscriptions
  created_via, confirmed_at, last_seen
```
This replaces the separate designs in C4/C5 and the old H8 recipient file.

## Two link shapes
| | Personal — `/i/<token>` | Open — `/join/<trip>?lang=de` |
| --- | --- | --- |
| Generated | one per person, name + language baked in | one per trip, for group chats |
| Landing | already in their language, name prefilled | language from param, else `Accept-Language` |

**Decision 19 — forward freely, approve individually.** The link is an
*invitation to request*, not a grant. A forwarded personal link only prefills;
identity still comes from email confirmation, so it can't impersonate.

## Scope
- Collection form (C11): one screen, big type, their language. Name, email,
  optional address labelled *"only if you'd like a real postcard in the mail"*,
  two separate checkboxes. Reads like a guestbook, not a signup.
- Double opt-in (C12) via W08's code path
- Self-serve edit/unsubscribe page (C13) — language, address, opt out, delete me
- **Encrypt postal addresses at rest (C14)** — AES-GCM, key from env, never in
  the content folder, never logged. ~50 home addresses is a different risk class
  from anything else in this repo.
- Abuse guard on the open link (C15) — rate limit, nothing printed without approval
- **Approval notification (C16)** — email on each request, linking into the
  overview. Requests must not sit unseen while travelling.
- Admin surface (C6): pending, approved, last seen, revoke

## Acceptance
- [ ] Personal link opens in the right language with the name prefilled
- [ ] Forwarding it creates a *separate* pending contact, never an impersonation
- [ ] Approval email arrives (file transport) and links into the overview
- [ ] Addresses are unreadable in the DB without the key; absent from all logs
- [ ] Unsubscribe works from a mail footer in one click, no login
- [ ] Delete-me removes the contact and all grants

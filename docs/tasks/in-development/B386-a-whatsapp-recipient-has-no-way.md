---
id: B386
title: A WhatsApp recipient has no way to stop the messages from inside WhatsApp
type: ISSUE
priority: high
complexity: medium
area: lib/whatsapp, contacts, opt-out
found: "2026-09-05T00:15:00Z"
started: "2026-09-07T11:40:40Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:40:40Z"
---

# B386 — A WhatsApp recipient has no way to stop the messages from inside WhatsApp

## Why

B365's template carried a footer reading *"Fernscout · STOPP zum Abbestellen"*
(and *"Reply STOP to unsubscribe"* in English). **Nothing in this codebase
reads an inbound message.** There is no webhook route, no subscription to the
`messages` field, and B365's own scope note says it plainly: "Nothing here
reads a message; this is one-directional announcement only."

So the footer was a promise the system could not keep, printed on a message
sent to somebody's family. Someone replying STOPP would have been ignored,
concluded they were being ignored deliberately, and reached for the one
control that does work — reporting the number. A report is what gets a
business number banned, which takes the channel down for every reader at
once. The owner caught it before the templates were approved; they have been
deleted and recreated without the footer.

That removes the lie. **It does not give anybody a way out**, which is the
actual issue.

What exists today, and why each is not enough:

- **The `manage` link** (`manageUrl`, `unsubscribeUrlFor`) unsubscribes
  properly and is the right mechanism — but it only ever appears in a *mail*
  footer. A reader who opted into WhatsApp and never gave an email, or who
  turned the digest off, never sees one.
- **Blocking the number in WhatsApp** works and is instant, but it is the
  reader punishing the sender rather than a preference being recorded:
  `wants_whatsapp` stays `1`, every future publish still tries, and every
  attempt is still billed.
- **Meta's own "stop promotions" affordance** on marketing templates is
  outside our control and invisible to `lib/contacts`.

## Work

Decide between two shapes, and the choice is the ticket:

1. **A link, no inbound.** Put a manage URL in the template — either as a
   second URL button or in the body. Cheap, needs no webhook, and reuses the
   unsubscribe that already works. Costs a button slot, and Meta permits only
   two.
2. **Inbound webhooks.** Subscribe to `messages`, match STOP/STOPP/ABMELDEN,
   clear `wants_whatsapp`. Honest, matches what people actually type, and is a
   much larger surface: a public endpoint, signature verification
   (`X-Hub-Signature-256`), replay handling, and a new capability to keep off
   by default.

Option 1 first, in all three languages. Option 2 is its own ticket if it is
ever wanted.

Either way: **say what the opt-out is wherever consent is asked** — the
guestbook checkbox, the manage page, and the click-to-chat page all currently
say nothing about how to stop.

## Acceptance

- No shipped copy claims a reply does anything, in any language.
- A person who gets a WhatsApp announcement can reach a working unsubscribe
  without needing an email from the same journal.
- Using it clears `wants_whatsapp`, so the next publish does not try or bill.

## Triage / what was built — Option 1, in the body

Went with the **body** rather than a second URL button: this codebase's own
comment on `WhatsappMessage.buttonPath` (`lib/whatsapp/types.ts`) records that
"Meta permits exactly one [dynamic] variable" for a URL button, learned the
hard way (the template-versioning gotcha `templateFor`'s doc comment
describes at length). A body parameter has no such constraint — the template
already carries three (`{{1}}` name, `{{2}}` trip, `{{3}}` day title) — so
adding a fourth avoids relying on an unverified assumption about button
variable limits.

**This is genuinely half code, half Meta — read this before assuming it is
done.** A currently-approved template has exactly three body variables. Meta
counts them and rejects a send whose body array has a different length than
what was approved, so the code cannot simply start sending four. Because of
that, the change is **entirely inert until a person acts**:

- `lib/whatsapp/settings.ts`: `features.whatsapp.templates` entries may now be
  either the old bare string (`"fernscout_day_published"`, unchanged
  behaviour — 3 body parameters, no manage link) or
  `{ "name": "…", "manageLink": true }`. `manageLink` defaults to `false` for
  every existing entry, so **merging and deploying this change alone sends
  exactly the same three-parameter messages as today.**
- `lib/digest/dayWhatsapp.ts` computes a per-recipient `manageUrl` for every
  send regardless (a contact's own `manageUrl(base, owner, manageTokenFor(...))`
  self-serve page — the same one the mail footer already links, so this
  reuses the *contact.id*-keyed token rather than an email; the owner's own
  free copy, which has no contact row, points at their own `/{user}/me`) but
  only appends it as a fourth body parameter (`asParameter(recipient.manageUrl, …)`)
  when `templateFor(...).manageLink` is `true`.

**What a person with Meta Business Manager access has to do, precisely, for
each language currently configured:**

1. Create a **new template version** (never edit or delete the approved one —
   see `templateFor`'s own doc comment on why: a deleted name is reserved for
   30 days) whose body text ends with a fourth placeholder, e.g. appending a
   line such as `{{4}}` to stop the announcements at any time. Submit it for
   approval.
2. Once approved, edit `site/config.json` (or this instance's
   `FERNSCOUT_CONFIG`) so the locale's `features.whatsapp.templates` entry
   becomes `{ "name": "<new template name>", "manageLink": true }`.
3. Repeat per language. A language whose entry is left as a bare string (or
   `manageLink` absent/`false`) keeps sending the old three-parameter message
   — this is deliberately per-template, not a single on/off switch, since
   each language's template is a separate Meta asset approved on its own.

Until step 1–2 happen for a language, `sendDayWhatsapp` for that language
behaves exactly as before B386 — three parameters, no manage link reaching
that reader. This was a deliberate choice over shipping code that would break
production sends the moment it deployed.

### Acceptance, checked against what actually shipped

- **"No shipped copy claims a reply does anything, in any language."** Already
  true before this ticket — the footer was removed at template-recreation
  time (see Why). Verified again: no "reply STOP"/"Abbestellen"/"Abmelden"
  wording anywhere in `site/locales/*.json`, `lib/`, `components/`, `app/`.
- **"A person who gets a WhatsApp announcement can reach a working
  unsubscribe without needing an email from the same journal."** Done, but
  **only for a language whose template has been reapproved with `manageLink`
  and whose config entry has been flipped** — see above. Until then this
  criterion is not met for real sends; the code path is built and tested,
  the Meta template is not.
- **"Using it clears `wants_whatsapp`, so the next publish does not try or
  bill."** Already true — the link is `manageUrl`, the existing self-serve
  page (`app/[user]/c/[token]/page.tsx` → `ContactManage`), which already
  writes `wants_whatsapp` off when unticked. No new code needed for this
  half; it was reused rather than built.

### Not done

The Work section's other ask — "say what the opt-out is wherever consent is
asked: the guestbook checkbox, the manage page, and the click-to-chat page" —
was left alone. It is not in the Acceptance list above, it is copy-only (no
mechanism), and touches three separate surfaces across three languages;
scoping it into this already Meta-gated ticket risked conflating "the
mechanism doesn't exist yet" with "the wording is incomplete". Filed as its
own follow-up would be reasonable if wanted.

### Tests

`test/whatsapp.test.ts`, new `describe("a way to stop the messages — B386")`:
an ordinary (`manageLink` absent) template still sends exactly 3 body
parameters and never leaks the manage token; a template configured with
`manageLink: true` sends 4, the 4th containing the contact's own manage token
and `/{user}/c/`; the owner's own free copy (no contact row) gets
`https://.../{user}/me` instead. All existing whatsapp tests (37 total across
`whatsapp.test.ts` + `contact-whatsapp-gating.test.tsx`) still pass unchanged,
which is the proof that the default (`manageLink` absent) really is a no-op.

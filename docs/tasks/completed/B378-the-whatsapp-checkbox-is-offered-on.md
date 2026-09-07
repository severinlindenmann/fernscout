---
id: B378
title: The WhatsApp checkbox is offered on a journal with WhatsApp switched off, one line under a hint saying nothing sends there
type: ISSUE
priority: medium
complexity: low
area: contacts
found: "2026-09-04T21:43:00Z"
started: "2026-09-07T11:06:03Z"
merged: "2026-09-07T11:35:07Z"
completed: "2026-09-07T13:09:44Z"
---

# B378 — The WhatsApp checkbox is offered on a journal with WhatsApp switched off, one line under a hint saying nothing sends there

## Why

B360 gated the postal block on `postcards`, and B376 made the phone hint name
only the capabilities actually on. The WhatsApp checkbox itself was left
ungated, and it is now the last one standing.

On the invite landing page of a journal with neither capability enabled, two
adjacent lines say opposite things:

> Phone number (optional)
> **kept on file for the owner -- nothing on this site sends to it yet**
>
> [ ] Send me an email when there are new days to read
> [ ] **Message me on WhatsApp when a new day goes up**

Observed 2026-09-04 on fernscout.ch at e85248d. The hint is right and the
checkbox is the one telling the reader something untrue -- and a reader who
ticks it has asked for a message nothing will ever send.

Note the server-level capability can be on while the journal's own is off,
which is this case: `/api/health` reports `whatsapp.enabled: true`, and
`isEnabled("whatsapp", "<journal>")` is false because the journal never asked
for it. The gate has to be the journal-scoped one, the same call B360 and B376
already thread through as `whatsappEnabled`.

## Work

Gate the checkbox on the `whatsappEnabled` prop those two tickets already
carry into `InviteRedeem`, `ContactForm` and `ContactsAdmin`'s `GuestForm` --
the plumbing is there and unused for this. Follow how the postcard checkbox
beside it is gated.

Rows that already hold a WhatsApp preference are untouched; this is about what
is offered, not what is stored.

## Acceptance

With WhatsApp off for a journal, no invite or guestbook form offers a WhatsApp
checkbox. With it on, all of them do.

## Resolution

Confirmed against current code: the checkbox was rendered unconditionally in
all three components while `whatsappEnabled` was already threaded down and
spent only on `telHintKey`'s wording.

Wrapped the checkbox in `{whatsappEnabled && (...)}`:
- `components/InviteRedeem.tsx:502` (the "form" step's tick-box block)
- `components/ContactForm.tsx:441` (the guestbook's three-checkbox block)
- `components/ContactsAdmin.tsx:868` (`GuestForm`'s owner-facing checkbox)

Rows that already carry `wantsWhatsapp: true` from before a journal switched
the capability off are untouched — the checkbox stops being offered, but the
value in the form state (and on save) is unaffected. Doc comments on each
`whatsappEnabled` prop updated to say the checkbox is gated too, not only the
hint.

**Test**: `test/contact-whatsapp-gating.test.tsx` — renders each of the three
components with `whatsappEnabled` true and false and asserts the checkbox's
label text is present/absent. All three pass.

**What this tells a non-owner caller**: nothing new. The prop already existed
and was already readable from the page's own capability check
(`isEnabled("whatsapp", username)`); this only changes what is rendered, not
what any request discloses.

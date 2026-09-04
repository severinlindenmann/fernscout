# W11 — Email digest

**Roadmap:** D2, D6, D8, decision 6 · **Depends on:** W07, W10 · **Wave G**

> **This is the primary notification channel** (decision 6: ~20–50 readers, most
> will never install anything). It gets the care push would otherwise get.

## Scope
- "3 new days since you last looked" — per recipient, per their `preferred_locale`,
  respecting trip visibility (W09) and their channel preferences (W10)
- Trigger: on publish, or a weekly digest; both configurable
- One HTML template + text alternative, big type, few images, one clear link.
  Assume a 70-year-old on a phone in a mail client from 2019.
- **Quiet rules (D8)**: never more than one a day; never at 3am in the
  recipient's timezone
- Preferences page (D6) linked from every footer; one-click unsubscribe header
- Idempotency: a crash mid-send must not re-mail everyone

## Acceptance
- [x] Each recipient's mail is in their own language
- [x] A recipient without access to a private trip sees nothing about it
- [x] Re-running the sender does not duplicate mail
- [x] Renders correctly in a plain text client
- [x] Unsubscribe works without logging in
- [x] Quiet rules verifiably enforced across timezones (unit tests)

## How it landed

`lib/digest/` decides, `npm run digest -- --user <name> [--dry-run] [--since]`
sends, `digest_sends` (migration `004-digest`) remembers. Three decisions worth
knowing before changing anything here:

- **A password-protected trip is never in a digest**, grant or no grant. The
  password gate has no database behind it (W09), so a grant does not open it,
  and a line about a trip the reader cannot open is worse than no line at all.
  `lib/digest/visibility.ts` is the single place that changes when identified
  access can unlock the gate.
- **No timezone column.** A reader's language is used as their timezone band
  where that means something (`de`, `hu` → CET/CEST) and `DIGEST_TIMEZONE`
  stands in everywhere else. A field nobody fills in would be a confident wrong
  answer; see the note at the top of `lib/digest/quiet.ts`.
- **A row is claimed before the transport is called.** A run that dies mid-send
  costs one reader one digest and never mails anybody twice.

The preferences page is W10's `/{user}/c/{token}`, extended rather than
duplicated: the digest footer links to it in the reader's own language, and the
mail template grew an optional localisable footer to make that possible.

# W07 — Mail transport

**Roadmap:** D3, K7 · **Depends on:** W02, W06 · **Wave D**

## Goal
Send mail in production; in development, write it to a folder you can open.
No account needed to build or test anything.

## Scope

### Transports behind one interface
| Transport | Use |
| --- | --- |
| **`file`** (dev default) | Writes `./mail/<timestamp>-<to>-<subject>.eml` — real RFC822, openable in any mail client. **`./mail/` is gitignored.** Also prints a one-line summary to the console. |
| `smtp` | Proton SMTP Submission (decision 17). Host/user/pass from env. |
| `console` | Log only, for CI |

- `sendMail({ to, subject, html, text, headers })` — nothing else in the
  codebase touches a transport.
- Templates: one layout, per-locale (W04), plain-text alternative always.
- **One-click unsubscribe** headers (`List-Unsubscribe`,
  `List-Unsubscribe-Post`) on anything bulk — required for deliverability.

### Production readiness (K7)
Document SPF, DKIM and DMARC for `fernscout.ch` in `docs/deploy-mail.md`.
Not testable locally; write it down so it isn't forgotten.

## Acceptance
- [ ] `mail.enabled=false` → no mail code path runs, no startup error
- [ ] `transport=file` writes a valid `.eml` that opens correctly
- [ ] Rendered mail is legible at 16px+ on a phone, with a text alternative
- [ ] Switching transport is config-only, no code change
- [ ] `./mail/` is gitignored

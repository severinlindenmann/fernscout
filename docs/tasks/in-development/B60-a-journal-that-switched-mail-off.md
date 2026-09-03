---
id: B60
title: A journal that switched mail off still has mail sent on its behalf
type: ISSUE
priority: medium
complexity: low
area: mail, capabilities
found: "2026-09-01"
started: "2026-09-03T19:23:10Z"
session: a4b53c2f-00e4-4e62-bc65-91f1f227b1e1
claimed: "2026-09-03T19:23:10Z"
---

# B60 — A journal that switched mail off still has mail sent on its behalf

## Why

Found on the live server while verifying B57. `/api/health` reports, for the
journal `sevi`:

```json
"sevi": { "mail": { "enabled": false, "reason": "not enabled by sevi" } }
```

Requesting a sign-in code for that journal sent one anyway, and — with B57's
`keepCopy` on — wrote the copy into `content/sevi/mail/`.

`isEnabled(name, username?)` (`lib/capabilities.ts:156`) takes the journal, and
`resolveOne` narrows the server-wide answer with that journal's own config.
**Every mail call site omits the argument:**

- `lib/mail/index.ts:160` — `sendMail`, which already has `mail.username` in
  its hand and does not pass it
- `lib/journals.ts:285` — the welcome letter
- `lib/deletions.ts:223` — the deletion confirmation link
- `lib/digest/index.ts:274` — the digest
- `app/api/auth/signup/request/route.ts:27`

So a per-journal `features.mail.enabled: false` narrows what `/api/health`
*reports* and nothing else. That is the "absent, not broken" rule in
`AGENTS.md` inverted: the capability is reported off while the feature runs.
Somebody switching mail off for their journal — the obvious way to say *do not
write to my readers* — gets no indication it did not take.

B57 makes it worse rather than causing it: those journals now also accumulate
`.eml` copies containing live sign-in links, in a folder whose owner has said
they do not want mail at all.

## Work

The fix is small; deciding what the switch *means* is the part worth thinking
about, because these are not all the same kind of mail.

- `sendMail` should pass `mail.username` to `isEnabled` — one argument, and it
  covers every caller that sets `username`, which is most of them.
- But decide first, and record here: does a journal's `mail: false` stop
  **transactional** mail as well as the digest? A sign-in code and a deletion
  confirmation are not newsletters; suppressing them silently locks the owner
  out of their own journal and makes B38's deletion flow unusable rather than
  refused. The likely right answer is that the per-journal switch governs mail
  *to readers* (digest, welcome, invitations) and that authentication and
  destructive-action confirmations are not subject to it — but that
  distinction does not exist in the code today and has to be written down
  wherever the config is documented.
- Whatever is decided, `/api/health` must report something a person can act
  on. Reporting `enabled: false` for a journal that will still receive sign-in
  codes is the current lie and must not survive the fix.
- A caller that omits the username should be the exception with a reason beside
  it, not the default.

## Acceptance

- A journal with `features.mail.enabled: false` receives no mail of whatever
  classes the decision above says it should not, asserted by a test per class.
- Any class deliberately exempt is named in the test and in the docs, with the
  reason.
- `/api/health`'s per-journal mail block agrees with what actually happens.
- No `.eml` copy is written for a journal whose mail is suppressed.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

---
id: B934
title: An invite link has to be selected by hand on a phone
type: ISSUE
priority: medium
complexity: low
area: agent, ui
found: "2026-09-08T09:00:16Z"
started: "2026-09-08T20:16:45Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T20:16:45Z"
---

# B934 — An invite link has to be selected by hand on a phone

## Why

`/<user>/contacts` lists every issued invite link (`InviteRow` in
`components/ContactsAdmin.tsx`), and for one with a recoverable token
(`AdminInvite.url`, since B280) the only way to get at the URL was
`CopyLine`'s button — the raw value lived nowhere in the DOM, only inside the
click handler and, deliberately, not in the button's accessible name (B199
keeps a credential out of that). `navigator.clipboard.writeText` is refused
often enough to matter (no secure context, a denied permission, an old
browser) — `CopyLine`'s own comment says so ("the address is on screen and
selectable, so saying nothing is better than an apology") — but for this one
row that premise was false: nothing was on screen. `/<user>/contacts` is
specifically the page B280 built so a lost link could be shown again, which
makes it the worst place for that to be true — the reader stuck manually
copying a link out of a phone, character by character with no visible text to
select, is exactly the reader this row exists for.

Every other place a link or credential is handed over already gets this
right: `ContactsAdmin`'s own `freshLink` block, `InviteToRead`'s `link`, and
the credentials in `AgentHandover`/`BuddyHandover` all show the raw value in a
visible `<code>`/`<pre>` block *and* offer `CopyLine` beside it. `InviteRow`
was the one exception.

## Work

Added a `<code className="break-all …">{invite.url}</code>` block in
`InviteRow` (`components/ContactsAdmin.tsx`), shown whenever a live invite has
a recoverable `url` — same pattern as `freshLink` a few hundred lines above
and `InviteToRead.tsx`. `CopyLine` stays as the one-tap shortcut; the raw text
is now the fallback route that survives a refused clipboard. No new UI
strings needed (no visible label added, just the existing value rendered as
text), so no locale files touched.

Test: `test/invite-panel.test.tsx` — "a recoverable link is on screen as
selectable text, not only behind the copy button" — asserts the raw URL
string appears in the rendered HTML. Verified it fails on the pre-fix
component (`git stash` of the change) and passes after.

## Acceptance

- [x] A live, recoverable invite link (`AdminInvite.url` set) renders its raw
      URL as visible, selectable text on `/<user>/contacts`, not only inside a
      copy button. Evidence: `test/invite-panel.test.tsx`, new test in
      "copying a link that was already sent".
- [x] The copy button (`CopyLine`) is unchanged and still offered beside it as
      the one-tap shortcut. Evidence: existing tests in the same file still
      pass ("a live link with a recoverable token offers the copy control").
- [x] The URL still does not appear in the copy button's accessible name
      (B199's rule for a credential). Evidence: existing test "the copy
      control does not recite the URL as its accessible name" still passes.
- [x] No `window.confirm`/`alert`/`prompt` introduced.
      `test/no-browser-dialogs.test.ts` passes (see verify run below); this
      change touches no dialog/confirmation code at all.
- [ ] Actually dragging a finger to select the text on a real phone screen is
      not checkable from this environment — no device, no browser. The fix
      guarantees the text is present, unobscured, and in a monospace block
      wide enough to wrap (`break-all`) rather than clip, which is the part
      that is checkable here; how comfortable the selection gesture feels on
      an actual touchscreen needs a person or `test-in-a-browser` at a phone
      viewport to confirm.

## Verify

`npm run verify` — see session notes for full output; all steps (build, tsc,
eslint, vitest, knip) passed except the two known-noise items called out in
the dispatch (task-ids.test.ts snapshot drift, unrelated to this change).

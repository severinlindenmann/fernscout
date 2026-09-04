---
id: B392
title: The owner console on /me is a flat wall of same-weight headings
type: FEATURE
priority: medium
complexity: medium
area: me page, design
found: "2026-09-05T01:00:00Z"
started: "2026-09-04T22:37:41Z"
session: 3d8b93dd-e447-4c3c-bcd1-fa37e2bd17f9
claimed: "2026-09-04T22:37:41Z"
---

# B392 — The owner console on /me is a flat wall of same-weight headings

## Why

The owner block on `/<user>/me` — "Das ist dein Tagebuch" down to the invite
button — is one cream box holding five unrelated concerns as a stack of
identical `h3 + p + p + button` groups: get a key, what a key can do, the live
keys, the credit balance (B367), and the invite door. Nothing groups them,
nothing ranks them, and the one figure a person actually scans for — the credit
balance — is a sentence in the middle of the wall, indistinguishable from the
prose around it. On a phone it is a long undifferentiated scroll.

The three real jobs are the agent, the money, and the people. The markup should
say so.

## Work

`app/[user]/me/MePageContent.tsx`, the `{viewer.owner && …}` section only.
Reshape it into a titled region plus three white concern-cards, using the
palette and card vocabulary already in the file (`rounded-2xl border
border-navy-200 bg-white`, the same inset `ContactManage` already uses):

- **Der Agent** — `AgentHandover`, the "what a key can do" explainer with the
  warning as a proper inset callout, and `AgentKeys`. Do not rewrite those two
  child components — `AgentHandover` is shared with the empty-trips view.
- **Guthaben** — the signature. The balance as a featured display numeral in a
  tinted well, a compact per-channel cost breakdown beside it, the flat price
  as a caption, and the inert Buy button (B368 still owns the real flow). The
  zero state is an emphasised notice, not a grey sentence.
- **Wer mitliest** — the invite intro and the contacts button.

Each card carries a small lucide icon marker (all of `KeyRound`, `Wallet`,
`UserRound`, `Mail`, `MessageCircle` resolve). Mobile-first: cards stack full
width; the credit card's well and breakdown sit side by side from `sm`.

Keep every gate exactly as it is — `payment` absent, `contactsEnabled`,
`isEnabled("whatsapp")` — this is presentation only. New strings in all three
locales, `npm run i18n:keys` regenerated.

## Acceptance

- `npm run verify` green.
- `test/access-panel.test.tsx` still passes (the panel renders for the owner
  only, is absent with credits off, WhatsApp row omitted when null) — extended
  if a new element needs pinning, never loosened.
- By eye at 375px and at desktop: three distinct cards, the balance reads as a
  featured number, no regression to who sees what.

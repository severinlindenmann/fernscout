---
id: B802
title: Signed-in landing has no docs link when helper is off (B797)
type: ISSUE
priority: low
complexity: low
area: landing, docs
found: "2026-09-07T15:13:02Z"
superseded: fixed inside B797 before it merged — Docs is no longer gated on the helper
---

# B802 — Signed-in landing has no docs link when helper is off (B797)

## Why

B797's acceptance criteria said two things that, together, leave a hole for
one reader: (1) "with the `helper` capability off, neither [Agent nor Docs]
appears" in `PageHeader.tsx`, and (2) "the signed-in landing no longer
carries … the docs link" — unconditionally, not only when helper is on.

Before B797, `components/Landing.tsx`'s signed-in branch (`phase === "in"`)
always rendered `<DocsLink />` at the bottom of the block, regardless of the
`helper` capability. B797 removed that block outright for the signed-in
reader (see `components/Landing.tsx`, the block right after `{publicList}`),
on the reasoning that the header now carries a Docs symbol on every page. But
the header's Docs symbol is gated on `helper` alongside Agent (see
`components/PageHeader.tsx`, both the mobile panel and the `sm+` chip row),
per B797's own acceptance line.

Net effect: a signed-in reader on `/`, on an instance with `features.helper`
off — the default for every self-hoster — now has **no click-through to
`/docs`** from that page at all. It is still reachable by typing the URL, and
`HomeJournals`' "Read the guide" link (`/docs/guide/guest`) survives as a
narrower substitute, but the general docs entry point that used to be right
there is gone for exactly the readers who are most likely to need it (running
their own instance, no helper configured).

## Work

Decide, and then implement, one of:

- Give the header's Docs symbol its own gate, independent of `helper` (it was
  the original instinct while building B797, reverted for literal compliance
  with B797's acceptance line — see that ticket's "What was built" section).
  This would mean Docs shows on every page regardless of the `helper`
  capability, while Agent still gates on it alone.
- Or restore `<DocsLink />` (or an equivalent) to the signed-in landing
  specifically for the `!helperEnabled` case, mirroring how `AgentBlock`
  already survives there for a reader who owns no journal.

Either fixes the same gap; they are not both needed. The first is probably
the better product decision (Docs is not an agent feature and needs no
capability to be true), but changes B797's stated acceptance, so say so
explicitly if that path is taken.

## Acceptance

- A signed-in reader on `/`, on an instance with `helper` off, has some
  visible route to `/docs` from that page — either the header symbol or a
  restored landing link.
- A signed-in reader on `/`, on an instance with `helper` on, is not shown
  the docs link twice (header symbol only, as B797 intended).

## Superseded, 2026-09-07

Fixed in B797 itself rather than left for later. The cause was an acceptance
line in B797 that said "with the helper capability off, neither appears" —
which was right for the agent and wrong for the docs. `/docs` needs no
capability, so gating it beside the agent left a self-hoster with the helper
off, which is the default, no route to the documentation at all once the
landing page's own link was removed.

The two are now split in `components/PageHeader.tsx`, in both the mobile panel
and the desktop row: the agent entry is gated on `helper`, the docs symbol is
always there. Measured with the helper off: no `/agent` link, one `/docs` link
at 332×44, header still 65px.

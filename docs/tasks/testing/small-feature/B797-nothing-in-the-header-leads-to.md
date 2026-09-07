---
id: B797
title: Nothing in the header leads to the agent, and the signed-in landing repeats the invitation in a block of its own
type: FEATURE
priority: high
complexity: medium
area: header, nav, landing, agent
found: "2026-09-07T17:10:00Z"
started: "2026-09-07T14:57:20Z"
merged: "2026-09-07T15:21:33Z"
---

# B797 — Nothing in the header leads to the agent, and the signed-in landing repeats the invitation in a block of its own

## Why

Three requests from the owner in one sitting, which turn out to be one change:

1. *"in the menu nav add a button Agent with an icon to the agent page."*
2. *"the Agent must be big, feeling like a call to action to press it"* —
   *"Agent with an icon, written out maybe if the mobile space fits."*
3. *"remove that from the main page and instead add on the main page in the
   header also an Agent and Doc symbol"* — pointing at the signed-in landing's
   "Heutigen Tag schreiben" button, the paragraph under it, the "Schon einen
   eigenen Agenten?" disclosure, and "Dokumentation lesen".

The through-line: **the way in to `/agent` should live in the header, on every
page, rather than as a block on one page.** Today it is the other way round —
the seven-destination nav has no agent entry at all, so once a reader is
inside a journal there is no route to the helper; and the signed-in landing
spends most of a screen re-offering what the header should carry everywhere.

Since B770 the header is one row on a phone with a menu behind it, and
`useNavEntries()` in `components/SiteNav.tsx` is the single source of the
destinations. That is the seam this goes through.

## Work

**The agent entry is not one of the seven.** The other destinations are places
inside a journal — days, gallery, map, figures, search. `/agent` is where you
go to *write*, it is instance-level rather than trip-level, and the owner asked
for it to read as a call to action rather than another tab. So: an icon **and
the word**, at call-to-action weight, visually separated from the destination
icons rather than appended to them.

- On a phone, in the header row if it fits beside the title and the menu
  button — the row currently holds back, title, section disc, menu. If it does
  not fit, it is the first item in the menu panel and it is the emphasised one
  there. Measure at 390px and decide from the measurement, not from a guess.
- `yellow-400` with a `yellow-600` edge and `yellow-950` text is the
  established primary in this product since B733. Watch the collision: the
  header's current-section disc is also `yellow-400`. If both are yellow the
  row has two waymarks and neither means anything — resolve it deliberately
  and say how in this file.
- **Gate it on the `helper` capability.** With the helper off there is no
  `/agent` worth sending anybody to, and every self-hoster has it off. Same
  two-arrangement rule as B694 and B770.

**Docs gets a symbol too**, per request 3 — quieter than the agent, since it
is a reference rather than an action.

**Then take the block off the signed-in landing.** `components/Landing.tsx`
renders the write call to action, its explanatory paragraph, the
`AgentDisclosure`, and `DocsLink` for a signed-in reader. Once the header
carries both, that block is a second copy on the one page whose reader least
needs to be sold: they already have a journal. Remove it there; the signed-out
arrangement keeps everything it has, because that reader has no header entry
to use yet and is still deciding.

## Acceptance

- Every page inside a journal has a visible route to `/agent`, at
  call-to-action weight, with the word "Agent" shown wherever it fits.
- A docs symbol sits beside it, quieter.
- With the `helper` capability off, neither appears and nothing is broken.
- The signed-in landing no longer carries the write block, the disclosure or
  the docs link.
- The signed-out landing is unchanged.
- Every target ≥44px; checked at 390px; the header stays one row and no taller
  than B770 left it (65px). State the measured height.

## What was built, and why

**Where the Agent entry lives, per breakpoint.**

- **Below `sm` (the phone row):** the row already spends 44 (back, only for
  a reader with an identity) + 32 (section disc) + 44 (menu) of a ~358px
  content box, plus gaps, on four things before a single letter of the
  journal's name shows. Measured with icon-and-word added as a fifth
  control there: it can be made to *fit* by squeezing the title down to
  roughly 120px, but "fits" and "reads as a call to action" are different
  claims, and a CTA squeezed between three other 44px controls in an
  already-crowded row does not read as one. So it takes the ticket's own
  fallback literally: **Agent is the first item in the mobile menu panel,
  and it is the emphasised one there** — `bg-navy-900`, `min-h-14` (56px
  measured), full width of the panel (332px measured at 390px), icon and
  the word "Agent" always. Docs sits directly under it, quieter — `min-h-11`
  (44px measured), same width, ghost-style. The phone row itself is
  **unchanged**: still back/title/disc/menu, still 65px.
- **`sm` and up:** there is room, so icon-and-word sits inline in the
  header's chip row (with `TripSwitcher`/`CurrencySwitcher`/`LocaleSwitcher`),
  after them and before `SiteNav`'s own line — visually separated from the
  seven destination icons by being a different cluster, on a different line
  below `lg`, exactly as the ticket asked. `min-h-11` navy pill for Agent,
  `h-11 w-11` navy-outline-on-hover circle for Docs.

**The two-yellows collision.** Resolved by giving the Agent CTA
**`bg-navy-900` / `text-cream-50`** rather than `yellow-400` — the pattern
already used site-wide for a form's own primary submit
(`AskToBeLetIn.tsx`, `ContactForm.tsx`, `GuestSignIn.tsx`, `PushPrompt.tsx`),
so it is not a new colour, just a different established "strong control" than
the waymark one. `yellow-400` in this header keeps exactly one meaning:
`SiteNav`'s active-tab pill and `PageHeader`'s current-section disc both say
"this is where you are". The Agent CTA says something different — "leave the
journal, go write" — and giving it the same yellow would have made both
controls mean nothing the moment they appeared in the same row (the mobile
panel, and the desktop chip row, both have the section disc/active tab and
the Agent button visible at once). Docs stays quieter still: text-navy-600,
no fill, an outline hover only.

**Gating.** Contrary to my first pass, Docs is gated on `helper` **together**
with Agent, not independently — even though `/docs` itself needs no
capability. The ticket's acceptance line is explicit: *"With the `helper`
capability off, neither appears."* With helper off, every self-hoster's
default, the header carries neither symbol; the signed-in landing's
"bring your own agent" material (`AgentBlock`, shown only to a reader who
owns no journal yet — unchanged from B751) is that reader's only way in, same
as before this ticket. Added `SiteSummary.helperEnabled` (`lib/site.ts`,
`isEnabled("helper", user.username)`) as the plumbing, mirroring
`analyticsEnabled` exactly — journal-wide, viewer-independent, read by
`PageHeader`.

**One real gap left behind, captured rather than fixed here (scope):** with
helper off, the signed-in landing (`/`) used to carry `DocsLink`
unconditionally; the ticket's acceptance line asks for it to be removed
unconditionally too ("the signed-in landing no longer carries … the docs
link"). Net effect: a self-hoster signed in on `/` with helper off and no
capability giving them a header Docs symbol either now has **no** click-through
to `/docs` from that page at all (still reachable by typing the URL, and
`HomeJournals`' "Read the guide" link survives). Filed as B802 rather than
silently expanded scope.

## Measurements (390×844, headless Chrome, `reducedMotion: 'no-preference'`)

- Header height: **65px**, both helper on and off — unchanged from B770.
- Mobile row targets, helper on: title link 274×44, menu button 44×44 (plus
  the non-interactive 32×32 section disc). Same three when helper is off —
  the row does not change shape at all with the capability.
- Mobile panel, helper on, first two rows: **Agent 332×56**, **Docs 332×44**.
  Every existing row (TripSwitcher 60×44, CurrencySwitcher 65×44,
  LocaleSwitcher 56×44, the six `SiteNav` list rows at 332×48) unchanged.
- Mobile panel, helper off: neither `a[href="/agent"]` nor `a[href="/docs"]`
  present; panel starts straight at TripSwitcher, as before this ticket.
- Desktop/`sm+` chip row: Agent and Docs render after `LocaleSwitcher`,
  before `SiteNav`'s own line; both `min-h-11`/`h-11` (44px).
- Signed-in landing, helper on: neither "Write today's day", nor
  "Read the docs", nor the agent-disclosure copy render, for a reader who
  owns a journal or not.
- Signed-in landing, helper off + no owned journal: `AgentBlock` ("Your
  agent" / "Copy instruction") still renders, unchanged.
- Signed-in landing, helper off + owns a journal: nothing renders in that
  slot — unchanged from before this ticket (B751: that reader's way in is
  `/agent`'s own `AgentHandover` key).
- Signed-out landing: pixel-for-pixel unchanged (verified by screenshot;
  still opens with `ReaderInvite`, the hero, `AgentBlock`/`AgentDisclosure`,
  `PublicJournals`, `DocsLink`, colophon).

`npm run verify` (build → tsc → eslint → vitest): all four stages passed,
4658 tests passed (3 pre-existing skips, unrelated to this change), 0 new
lint errors (33 pre-existing warnings, none touched by this diff).

## Corrected before merge: Docs is not gated

This ticket's own acceptance said *"with the `helper` capability off, neither
appears"*. That was right for the agent and wrong for the docs, and building it
literally produced a regression: `/docs` needs no capability, so gating it
beside the agent left a self-hoster with the helper off — the default — with no
route to the documentation at all, because the landing page's own `DocsLink`
had just been removed on the strength of the header carrying it.

The two are now split in both arrangements: the agent entry is gated on
`helper`, the docs symbol always renders. B802 captured the regression and is
superseded by this fix.

Measured at 390px, `/example`:

| | header | `/agent` | `/docs` |
| --- | --- | --- | --- |
| helper off | 65px | absent | 332×44 |
| helper on | 65px | 332×56 | 332×44 |

The header did not grow — B770 left it at 65px and it is still 65px in both
states, because the agent entry lives in the panel rather than the row.

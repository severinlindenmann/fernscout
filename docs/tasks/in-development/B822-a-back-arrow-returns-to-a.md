---
id: B822
title: A back arrow returns to a fixed parent rather than where the reader actually came from
type: ISSUE
priority: medium
complexity: medium
area: navigation, ux
found: "2026-09-07T17:40:00Z"
started: "2026-09-07T16:20:43Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T16:20:43Z"
---

# B822 — A back arrow returns to a fixed parent rather than where the reader actually came from

## Why

Asked for: *"there are a few go-back arrows on the page — make sure it goes
back to the previous page and not just the main page."*

There are several, and each points at a fixed destination rather than at
history: `components/BackToJournal.tsx`, the arrow in
`components/PageHeader.tsx`, `app/agent/layout.tsx`, `app/docs/layout.tsx`,
and the photobook views. Follow three links inward and the arrow still sends
you to the top, so getting back to where you were means pressing it repeatedly
or using the browser's own control.

## Why this is not simply `router.back()`

That is the obvious fix and it is wrong on its own, which is the reason this
is a `medium` and not a one-liner:

- **Most readers here arrive deep.** The whole product is built around a link
  in an email to one day. For them there is no previous page inside the site,
  and `history.back()` leaves the site entirely — usually back to the mail
  client. That is worse than going to the journal home.
- **`BackToJournal` exists precisely for readers with no history**, and its
  comment says so: the trip gate and the invite form are dead ends reached
  from outside, and a fixed link was the fix.
- A back control whose destination cannot be predicted before pressing is also
  hard to label, and these carry words ("Deine Reisetagebücher"), not just an
  arrow.

## Work

The honest shape is *up, unless we know where you came from*:

- Use the in-app history when there is one — a same-origin referrer, or a
  navigation this app made. `next/navigation`'s router gives the tools; a
  small hook shared by all the arrows is better than each deciding.
- Fall back to today's fixed parent when there is not. Nothing regresses for
  the reader who arrived from a mail.
- The label has to stay honest. If the destination is dynamic, the word has to
  be generic ("Zurück") or derived from the actual target — not a promise of
  the journal home while going somewhere else.
- One implementation, used by every arrow listed above. Five components each
  guessing is how they drift.

## Acceptance

- From a day, into the gallery, into a photograph: the arrow retraces those
  steps rather than jumping to the journal home.
- Opening a deep link directly in a fresh tab and pressing back stays on the
  site and lands on the sensible parent.
- The label never says one destination and goes to another.
- Checked at 390px.

## Notes from the parent, before starting

**The five sites, and what each points at today:**

| where | destination | label key |
| --- | --- | --- |
| `components/PageHeader.tsx` | `/` | `nav.myJournals` |
| `components/BackToJournal.tsx` | the journal | its own |
| `app/agent/layout.tsx` | `/` | `docs.backToSite` |
| `app/docs/layout.tsx` | `/` | `docs.backToSite` |
| the photobook views | the trip | their own |

**Two of them are server components.** `app/agent/layout.tsx` and
`app/docs/layout.tsx` have no `"use client"` and call `translateIn` directly.
Anything that reads client-side history has to be a client child mounted in
them, not a change of their own boundary.

**`document.referrer` is not the answer**, and it is the first thing that
looks like one: with the App Router a client-side navigation does not update
it, so after two soft navigations it still names whatever loaded the tab.
`history.length` is not the answer either — it counts entries from other
sites in the same tab, so a reader who browsed elsewhere and then typed a
journal URL has a length greater than one and no in-app previous page.

What is left is to track it: record in-app navigations per tab
(`sessionStorage`, which is already per-tab) and let the control read that.
Either mechanism is acceptable —
`router.back()` guarded by that flag, or storing the previous in-app path and
linking to it — but say in this file which you chose and why. The second gives
a real `href` (middle-click, and a label that can name its destination); the
first keeps the browser's own history honest. Do not ship both.

## Decision

**Chose `router.back()` guarded by a flag.** `components/BackTracker.tsx`
(mounted once, in `app/layout.tsx`, so it sees every route this app has) marks
`sessionStorage["fs.backHistory"] = "1"` the first time the pathname it sees
differs from the one it mounted with — i.e. the first client-side navigation
in this tab. `lib/backNav.ts`'s `useHasInAppHistory()` reads that flag (via
`useEffect` + `useState`, so the first paint assumes deep-arrival and corrects
a tick later rather than risking a hydration mismatch). `components/BackLink.tsx`
is the one control: retracing renders a `<button onClick={() => router.back()}>`
with the generic `nav.back` label, deep-arrival renders a real `<Link
href={fallbackHref}>` with the caller's specific fallback label. Both
callers pass the labels already translated (`t(...)` on the client,
`translateIn(...)` on the server), so `BackLink` itself carries no
translation dependency and can drop into a server layout with no
`LocaleProvider` in scope.

Went with the flag over storing-the-path because every site here already
knows its own fallback destination and label; the only thing genuinely
unknown at render time is "is there anywhere to retrace to", which a boolean
answers exactly as well as a stored path would, for less code, and it keeps
the browser's own back stack authoritative rather than growing a second one
next to it.

**The fifth site turned out to be the fourth.** "The photobook views" is
`PhotobookPageContent.tsx` rendering plain `<PageHeader />` with no
`onHome` — there is no separate back-arrow anywhere in `app/[user]/(trip)/photobook/`
or `app/[user]/trips/[trip]/photobook/`; the "← Back" buttons in
`ReadTheBookView.tsx` and `DayLevelView.tsx` pop in-component view state
(`onBack` clears `drill` / closes the reading dialog) rather than navigating
a page, so they already retrace exactly as intended and were left alone.
Fixing `PageHeader.tsx` is what fixes the photobook page's arrow too, since it
is the same component instance — no fifth file needed touching.

## What was built

- `components/useBackHistory.ts` — the flag (`sessionStorage["fs.backHistory"]`)
  and the hook that reads it (`useHasInAppHistory`), read at mount so a deep
  arrival's first paint never disagrees with the server.
- `components/BackTracker.tsx` — mounted once in `app/layout.tsx`. Watches
  `usePathname()`; the first pathname it sees is never marked (nothing is
  before it), every pathname after that is a navigation this app itself made.
- `components/BackLink.tsx` — the one control. Renders a real `<Link>` to the
  caller's `fallbackHref`/`fallbackLabel` when there is nothing to retrace to,
  or a `<button onClick={() => router.back()}>` carrying the generic
  `retraceLabel` when there is. Both labels arrive pre-translated, so this
  component carries no translation dependency of its own.
- Wired into `components/PageHeader.tsx` (both the phone-width icon-only
  arrow and the `sm`-and-up breadcrumb), `components/BackToJournal.tsx`,
  `app/agent/layout.tsx` and `app/docs/layout.tsx`.
- New key `nav.back` ("Back" / "Zurück" / "Vissza") in all three shipped
  locales, regenerated into `lib/i18n.ts` with `npm run i18n:keys`.
- `test/back-link.test.tsx` — `BackTracker` never marks the flag on the
  pathname it mounts with; it does mark it once the pathname changes;
  `BackLink` renders the fallback `<Link>` with no flag set and the
  `<button>`-driven retrace once it is, and clicking that button calls
  `router.back()`.
- `test/agent-shell.test.ts` and `test/docs-shell.test.tsx` updated for the
  prop rename (`href="/"` → `fallbackHref="/"`); `test/trip-gate-copy.test.tsx`
  gained a `next/navigation` mock, since `TripGate` → `BackToJournal` →
  `BackLink` now reaches `useRouter()` even on the branch that never calls it.

## Verified in a real browser (390×844, headless Chrome)

Both journeys were driven against `/docs` and `/agent` (their back arrows are
unconditional) rather than the trip-scoped gallery path named in the
dispatch: `components/PageHeader.tsx`'s arrow only renders for
`site.hasIdentity`, and getting a signed-in owner session locally needs the
`auth` capability, which is off by default here (`auth_disabled` from
`/api/auth/identity/request`) — enabling it just to drive this ticket felt
like scope creep for a mechanism that is otherwise fully covered, both by
`test/back-link.test.tsx` (the logic, directly) and by the existing
`test/back-to-journals.test.tsx` (that `PageHeader` wires the right fallback
label to it for `hasIdentity`). The mechanism itself is identical wherever it
is mounted, so `/docs` and `/agent` exercise the same code path.

**Deep arrival** — fresh context, `GET /docs` directly:
  - label before pressing: **"Back to Fernscout"** (the specific fallback)
  - pressing the arrow → `http://localhost:3038/` (the fixed parent, stayed
    on the site)
  - same result for `/agent`: label "Back to Fernscout" → pressing lands on
    `/`.

**Retrace** — `/example` → (soft nav, via the phone menu) → `/docs`:
  - label after arriving: **"Back"** (generic, rendered as a `<button>` rather
    than a link — confirms the retrace branch)
  - pressing it → `http://localhost:3038/example` (walked back to where the
    reader came from, not to `/`)

Neither label promised a destination it did not go to.

## Cleanup before merge

`.local-dev.db`, `.data/` and `.next/` were removed before committing;
`git status` is clean save for this task file and the code changes listed
above.

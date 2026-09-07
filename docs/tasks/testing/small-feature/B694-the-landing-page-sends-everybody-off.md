---
id: B694
title: The landing page sends everybody off to fetch an agent of their own
type: FEATURE
priority: medium
complexity: low
area: landing, docs, i18n, agent
found: "2026-09-07T10:05:53Z"
started: "2026-09-07T11:27:36Z"
merged: "2026-09-07T11:58:21Z"
---

# B694 — The landing page sends everybody off to fetch an agent of their own

## Why

The hero at `/` opens with a dashed airmail box containing a prompt to paste
into an agent, three numbered steps about codes and tokens, and the sentence
*"Es gibt keine Bearbeitungsoberfläche, und es wird auch keine geben. Der Agent
ist der Editor."* That was the whole truth when the only way in was an agent
somebody already owned. Once the helper at `/agent` exists (B681–B688) it is
wrong twice over.

**It is the wrong first thing.** A visitor who does not have an agent — which
is most of them — meets an instruction they cannot follow and three steps about
seven-day tokens. The door that would actually work for them is not on the
page.

**And the closing sentence stops being true as written.** There is still no
CMS, the content is still markdown in a folder the person owns, and everything
still arrives as a draft — all of that must survive. What is no longer true is
the flat claim that there is no interface at all, when this instance now hosts
one. Said the old way it reads as a promise the site itself is breaking, which
is worse than saying nothing.

The claim is stated in nine places and they will not agree with each other
unless they are changed together:

- `site/locales/{en,de,hu}.json` — `landing.noEditor`
- `lib/api/documentation.ts` and `lib/api/openapi.ts` — the agent-facing copy
- `lib/api/agentCopy.ts` is where a sentence more than one document says
  belongs; check whether this one now qualifies
- `app/docs/helper/page.tsx` and `docs/helper.md`
- `docs/guides/de/creator.md`
- `AGENTS.md`, and `docs/ROADMAP.md` decision 24 itself
- `lib/tripWrite.ts`'"'"'s doc comment

## Work

**The hero.** Remove the copy-this-prompt box and the 01/02/03 steps from the
first screen (`components/LandingSections.tsx` — `LandingSteps`, and the
handover section above it). In their place: one primary call to action opening
`/agent`, and beneath it a quiet line for people who bring their own agent,
linking to the guide.

Roughly:

```
Ein Reisetagebuch, das dein Agent für dich schreibt.
<one paragraph, as now>

        [ Jetzt schreiben → ]

Schon einen eigenen Agenten? → Anleitung für Agenten
```

Nothing is deleted from the product — the instruction box, the three steps and
the copy button move further down the page or into `/docs`. They are still the
whole story for a self-hoster and for anybody already holding a token, and
`CopyLine` stays as it is.

**The capability decides which door is primary.** On an instance where `helper`
is off — the default, and what every self-hoster has — a button leading to a
page that cannot write is worse than no button. The hero reads
`capabilities()` and keeps the agent instruction as the primary route there.
One page, two arrangements, no second landing page.

**The sentence, once, correctly.** Rewrite `landing.noEditor` and every copy
listed above so that it keeps what is still true and drops what is not. It has
to survive both readings: there is no CMS and no form that edits somebody'"'"'s
markdown, the folder is theirs, an agent writes and a person publishes — and
this instance hosts an agent for people who have not got one. Decision 24 in
`docs/ROADMAP.md` is amended rather than deleted: the decision held, and the
helper is what it looks like honoured rather than reversed.

All three locales. `hu.json` exists and is not optional.

Not doing: any change to `/agent` itself (B681), and no new page.

## Acceptance

`/` on an instance with `helper` on leads to `/agent` in one tap from the first
screen, with the bring-your-own route still reachable and still complete. With
`helper` off the page is the one it is today. `grep -ri "keine Bearbeitungs\|no editing interface"`
returns nothing that contradicts the helper existing, in any of the nine
places, in any of the three locales. Checked at 390px.

## The `helper` capability decision

`lib/config.ts`'s `FEATURE_NAMES` does **not** name `helper` as of this build —
that is B684's, in flight in a sibling worktree at the same time as this
ticket, and this ticket does not add it (nor does it touch anything else in
`lib/config.ts`). `isEnabled("helper")` therefore cannot be called: it would
not typecheck against `FeatureName`, and even if it could, nothing today can
turn it on — `parseFeatures` in `lib/config.ts` refuses an unknown key under
`features`, so no `site/config.json` can honestly say `helper: { enabled:
true }` yet.

`app/page.tsx` reads a single `const helperEnabled = false;`, with a
`ponytail:` comment naming the coupling and the one-line swap to
`isEnabled("helper")` once B684 merges. This is not a placeholder standing in
for a missing feature — it is the only correct answer today: the capability
does not exist on any instance, so the hero's primary door must be the
bring-your-own instruction box, which is exactly what `false` produces. The
component-level plumbing (`Landing`'s `helperEnabled` prop, `LandingHero`'s
conditional CTA) is real and exercised by `test/landing.test.tsx`'s two new
cases (`renderLanding("en", true)` / `renderLanding("en", false)`) — only the
wire from `lib/config.ts` into `app/page.tsx` is stubbed, and it is a
one-line change when B684 lands.

## What changed while building

- **Locale keys**: `landing.helperCta` and `landing.helperOwnAgent` added (one
  contiguous block per file, after `landing.trips.one`) in `en.json`,
  `de.json`, `hu.json`; `landing.noEditor` reworded in all three.
  `lib/i18n.ts`'s `TranslationKey` union regenerated with `npm run i18n:keys`.
- **`components/LandingSections.tsx`**: `LandingHero` takes an optional
  `helperEnabled` prop (default `false`) and, when true, renders a primary
  `/agent` button (`landing.helperCta`) and a quiet `#handover` anchor link
  (`landing.helperOwnAgent`) beneath it — the anchor is the existing
  `AgentBlock` section id, so "linking to the guide" is a same-page scroll to
  the instruction box rather than a new page. `LandingSteps`' doc comment
  updated to say "no CMS" rather than "no editor".
- **`components/Landing.tsx`**: threads `helperEnabled` (optional, default
  `false`) from props into the signed-out hero. The signed-in order (which
  retitles `AgentBlock` as "your agent") is untouched — out of this ticket's
  named scope.
- **`app/page.tsx`**: computes `helperEnabled` (see decision above) and passes
  it to `Landing`.
- **`lib/api/documentation.ts`**: reworded the opening blurb and the "can you
  write here?" refusal paragraph in `instanceDocumentation()` (served at
  `/documentation.txt`) to point a tool-less agent at `{site.url}/agent`
  instead of dead-ending. Left `lib/api/openapi.ts`'s `costsVisibility`
  description and `lib/tripWrite.ts`'s doc comment alone — both are narrowly
  about a setting `/agent` v1 does not touch (trip-level `costsVisibility`,
  out of the wizard's "one day" scope per `docs/plans/2026-09-07-web-helper-agent.md`),
  so neither contradicts the helper existing. Left `/agent.md`'s own "no
  editing interface" line alone too — it is addressed to an agent already
  holding a token and is about there being no web form behind the API, which
  stays true.
- **`lib/api/agentCopy.ts`**: checked for a sentence duplicated verbatim
  across `documentation.ts`/`openapi.ts` that should move here, per the
  ticket's instruction. Found none — `NOT_WRITABLE`'s "no web form, no CMS and
  no upload page" is about `features`/costs specifically being unwritable
  through any door, not about writing in general, and doesn't contradict
  `/agent`. No change made.
- **`app/docs/helper/page.tsx`** and **`docs/helper.md`**: both reworded to
  introduce `/agent` (this instance's hosted door) alongside the separate
  `fernscout-helper` CLI toolbox (self-hosted, unrelated repo — same name,
  different thing, pre-existing confusion this ticket didn't invent or fix).
  Added a `next/link` import in the page (an `<a>` to `/agent` failed
  `@next/next/no-html-link-for-pages`).
- **`docs/guides/de/creator.md`**: reworded the opening claim and added a
  one-line note before the "Anfangen" steps pointing at `/agent` when
  available.
- **Tests**: `test/landing.test.tsx` — updated the stale `/no editing
  interface/i` assertion to `/no CMS/i`, added two cases exercising both
  arrangements. `test/guides.test.ts` — the "every creator guide says there is
  no editing screen" test now checks German against `/kein Formular|kein
  CMS/i` (English/Hungarian arms untouched, since those files weren't
  touched). `test/agent-interface.test.ts` passed unchanged — reworded the
  documentation.ts refusal paragraph to keep the exact phrases it greps for
  ("no upload interface", "no web form", "no CMS", "manually upload", "follow
  this guide themselves").
- **Backlog capture**: B717 — `README.md:9` has the same stale sentence and
  was out of this ticket's named scope (the nine places didn't include it).

## Verification

`npm run verify` — full pass: build, `tsc --noEmit`, `eslint .` (0 errors, 21
pre-existing warnings unrelated to this change), `vitest run` (336 files, 4320
tests passed, 3 skipped for no local Postgres — unrelated).

**390px check**: partially demonstrated. Both browser-automation MCPs
(Playwright and chrome-devtools) were locked for this entire session by a
concurrent sibling worktree session sharing the same browser profile
(`Browser is already in use for .../mcp-chrome-*, use --isolated`), and
retries across ~25 seconds did not clear it — no screenshot was taken.
Instead, verified structurally against a real `next dev` server on port 3101
in this worktree: with `helperEnabled=false` (the shipped default) `curl`
against `/` shows zero `href="/agent"` and the instruction box's "Copy
instruction" text present, matching today's page; temporarily flipping the
constant to `true` and re-fetching shows exactly one `href="/agent"`, the
"Start writing →" and "Already have your own agent? Guide for agents" strings,
and the instruction box still present (3 occurrences of "Copy instruction" —
the CopyLine button renders its label multiple times in the DOM). The flag was
reverted before committing. The CTA button and quiet line reuse the exact
Tailwind classes already used by `ReaderInvite`'s phone-width button
(`min-h-14 w-full ... sm:w-auto`) and by the existing `DocsLink`/`guides.readMore`
link pattern respectively, both of which are established 390px-safe patterns
elsewhere on this same page — but this is inference from reused classes, not
an observed render. **The 390px acceptance line is not fully demonstrated**;
a person (or a session with a free browser) should confirm visually before
this is treated as done.

## The capability swap, after merge

This was built beside B684, which is what added `helper` to `FEATURE_NAMES`,
so while it was in flight there was no capability to ask and `app/page.tsx`
hardcoded `helperEnabled = false` behind a `ponytail:` comment naming the
swap. B684 merged first, so the swap was made as a one-line follow-up on its
own branch (`b694-helper-capability-swap`): the hero now asks
`isEnabled("helper")`.

That is worth knowing when this is verified, because it changes what "on"
costs. `helper` is not a per-journal question — `lib/capabilities.ts` refuses
it outright unless `credits` is enabled too, since every model call is metered
and a helper without a ledger is an unmetered one billed to the operator. So
the "helper on" arrangement of the landing page cannot be seen on an instance
that has not also switched on credits and set `ANTHROPIC_API_KEY`.

**The 390px check is still outstanding** and is the one acceptance line
nothing here demonstrates — see the section above for why the browser was
unavailable. It needs somebody with a free browser profile.

## The 390px check, done after merge

It was the one acceptance line the build left undemonstrated, because both MCP
browser profiles were locked by a concurrent session. Driven instead with an
isolated Chromium (`playwright-core`, its own `userDataDir`) against a dev
server in this ticket's worktree, with `helper` and `credits` switched on in
`site/config.json` and `ANTHROPIC_API_KEY` set to a dummy — the landing page is
public and calls no model, so nothing was spent.

Both arrangements, at 390×844, full page:

| | `helper` on | `helper` off |
| --- | --- | --- |
| links to `/agent` | 1 | 0 |
| `document.documentElement.scrollWidth` | 390 | 390 |
| primary CTA box | 342×56 at x=24 | absent |

Neither arrangement scrolls horizontally, and the button clears the 44px tap
target this audience wants (J9 in `docs/ROADMAP.md` is the standing complaint
about the ones that do not). Helper on renders "Start writing →" as the
primary route with the quiet bring-your-own line beneath it and the
instruction box and 01/02/03 steps moved below — the ticket's sketch, built.
Helper off is byte-for-byte the page as it was.

The config edits were reverted and the server stopped; the worktree was clean
before removal.

**One capture came out of looking at it: B726.** The reworded `landing.noEditor`
ends "whether it's this instance's or your own", which is false on an instance
with the helper off — the same class of fault this ticket was opened to fix,
one paragraph further down.

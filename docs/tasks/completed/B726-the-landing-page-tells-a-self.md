---
id: B726
title: The landing page tells a self-hoster with the helper off that the agent may be this instance's own
type: ISSUE
priority: low
complexity: low
area: landing, i18n
found: "2026-09-07T12:05:00Z"
started: "2026-09-07T12:53:38Z"
merged: "2026-09-07T13:11:42Z"
completed: "2026-09-09T16:47:24Z"
---

# B726 — The landing page tells a self-hoster with the helper off that the agent may be this instance's own

## Why

Found while verifying B694 at 390px, in the screenshot of the arrangement it
was careful to get right.

B694 reworded `landing.noEditor` so that it stops promising there will never
be an editing interface. The new sentence ends:

> The agent is the editor, whether it's this instance's or your own.

That is true on fernscout.ch, where `helper` is on. It is false on every
instance where `helper` is off — which is the default, and which B694 itself
takes as the case worth protecting: it wrote a whole second arrangement of the
hero so that an instance with no helper does not offer a button leading to a
page that cannot write. The sentence beneath it then goes ahead and tells that
same reader the instance has an agent for them.

It is the same fault B694 was opened to fix, one paragraph further down: a
document making a claim about this instance that this instance does not
honour. Smaller, because it costs a reader a wrong assumption rather than a
dead end.

## Work

The sentence already renders inside a component that knows `helperEnabled` —
`app/page.tsx` resolves `isEnabled("helper")` and threads it to `LandingHero`.
So this is a second key rather than a conditional built from nothing: the
"whether it's this instance's or your own" clause belongs to the helper-on
arrangement, and the helper-off one wants the sentence B694 replaced, minus
the part that was false.

All three locales. `hu.json` is not optional.

Not doing: anything to the hero's two arrangements themselves. They are right;
this is the paragraph under them.

## Acceptance

On an instance with `helper` off, nothing on `/` claims this server hosts an
agent. On one with it on, the sentence reads as it does today. Checked in all
three locales.

## Done

Added `landing.noEditorNoHelper` beside `landing.noEditor` in all three
locale files (`site/locales/{en,de,hu}.json`) — the same sentence minus the
"whether it's this instance's or your own" clause. `LandingSteps` in
`components/LandingSections.tsx` now takes a `helperEnabled` prop (default
`false`, matching what it already inherited implicitly) and picks between the
two keys; `AgentDisclosure` passes `helperEnabled` explicitly since it only
ever renders in the helper-on arrangement, and the helper-off call site in
`components/Landing.tsx` needed no change — its default was already correct.
Regenerated `lib/i18n.ts` with `npm run i18n:keys`.

Extended `test/landing.test.tsx` with two tests: the helper-off render must
not contain "whether it's this instance's or your own" (any spelling of the
apostrophe — the rendered HTML escapes it as `&#x27;`), and the helper-on
render must still contain it.

Verified both arrangements at 390px in a real browser: helper off shows "The
agent is the editor." with no `/agent` link; helper on (via
`site/config.json` with `features.helper.enabled` and `features.credits.enabled`
both `true`, booted against a copy of the repo's `.local-dev.db`) shows the
full sentence, only inside the `AgentDisclosure` `<details>`, which is B748's
territory. No change needed to `app/page.tsx` — it already threaded
`helperEnabled` all the way down; the gap was only that `LandingSteps` never
received it.

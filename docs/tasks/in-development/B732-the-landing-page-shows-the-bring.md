---
id: B732
title: The landing page shows the bring-your-own-agent instructions to everybody, including the people who came for the helper
type: FEATURE
priority: medium
complexity: low
area: landing, agent
found: "2026-09-07T13:10:00Z"
started: "2026-09-07T12:17:50Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T12:17:50Z"
---

# B732 — The landing page shows the bring-your-own-agent instructions to everybody, including the people who came for the helper

## Why

B694 put the helper first and moved the bring-your-own-agent material further
down the same page rather than deleting it, on the reasoning that it is still
the whole story for a self-hoster and for anybody already holding a token.
That was right about keeping it and wrong about where: further down the page
is still *on* the page, so the first screen a visitor scrolls through is a
copyable prompt, three numbered steps about seven-day tokens, and a paragraph
about there being no CMS — none of which the person who just tapped "Start
writing" needs, and all of which they have to scroll past to reach the
journals.

The link that was supposed to serve the other audience — "Already have your
own agent? Guide for agents" — is an anchor to something already visible, so
it does nothing but move the viewport. It should be the thing that *reveals*
the material instead, which makes the page one screen shorter for everybody
and costs the audience it was kept for exactly one tap.

The owner asked for this directly, and for `Read the docs` to move below the
fold with it.

## Work

- **`<details>`, not state.** The disclosure is a native element: it is
  keyboard-operable, findable by the browser's own find-in-page, and needs no
  `useState` in a component that is already a client boundary for other
  reasons. `<summary>` carries the existing `landing.helperOwnAgent` string,
  so no new locale key is needed for the trigger.
- What it reveals is exactly what is there today, unmoved and unrewritten:
  `AgentBlock`, `LandingSteps`, and the `landing.noEditor` paragraph.
- **Only when the helper is on.** With it off there is no other door, so the
  material stays where it is, open, on the first screen. This is the same
  two-arrangement split B694 built and the same reason: a page that hides the
  only way in is worse than a long one.
- `DocsLink` moves below the public journals, in both arrangements.

Not doing: a new page or a new route for the agent instructions. `/docs` and
`/agent.md` already carry them for anybody who wants a URL, and B694's ticket
ruled out a second landing page.

## Acceptance

- With the helper on, the first screen is the heading, the lede, the call to
  action and the disclosure — no prompt box, no numbered steps, no `noEditor`
  paragraph until the disclosure is opened.
- Opening it reveals all three, unchanged.
- With the helper off the page is what it is today, except that `Read the
  docs` sits below the public journals.
- The disclosure works with a keyboard alone, and the summary is a 44px target
  at 390px.

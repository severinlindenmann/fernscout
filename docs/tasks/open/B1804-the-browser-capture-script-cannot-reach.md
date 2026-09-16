---
id: B1804
title: The browser capture script cannot reach a screen that needs a click, so only resting states get checked
type: CHORE
priority: medium
complexity: low
area: testing, browser
found: "2026-09-15T16:25:02Z"
---

# B1804 — The browser capture script cannot reach a screen that needs a click, so only resting states get checked

## Why

`.claude/skills/test-in-a-browser/check-page.mjs` takes a URL, a cookie and a
width, and photographs what renders. It cannot click, type or wait for a
selector — so it can only ever photograph a screen reachable by URL alone.

That is a real hole, and it has cost this project twice already in one week.
Both bugs were in the camera-roll import and both were missed the same way:

- **B1799** — the upload list pushed the page wider than a phone. Invisible on
  an empty list; obvious the moment real filenames were in it. The capture was
  taken on an empty list because that is the state a URL lands on.
- **The empty-run resume list** — every visit minted a run, so the resume screen
  filled with "0 photographs" cards. Found by the owner on a real phone after
  the feature had already been captured and called verified.

The import makes this sharp because its screens are chosen by client state
rather than by route: `components/extract/ExtractFlow.tsx:317-368` picks between
the resume list, the upload step, the found summary and the day board from
React state. Four of its screens have no URL at all. A capture of that flow
photographs the first screen and nothing else, which is exactly how a feature
gets called verified while five of its six screens have never been seen.

## Work

Give the script enough to reach a screen behind an interaction. The smallest
useful set, in order of value:

- `--click <selector>`, repeatable, with an implicit wait for the selector.
- `--wait-for <selector>` so a capture can be taken once something has rendered
  rather than after a fixed sleep.
- `--upload <selector> <file>` for a file input, since the one flow that most
  needs this starts with a picker.

Keep it a script rather than a framework. The value is that anybody can run one
command and get a PNG and a JSON; a test harness with its own vocabulary would
not get used.

The alternative worth considering and rejecting explicitly in the work: deep
links into flow state (`?step=board`). They would make capture trivial and they
would also be a permanent public surface built for tests, reachable by anybody,
that has to be kept honest forever. Say which you chose and why.

## Acceptance

- A single command captures the camera-roll import's day board — a screen four
  interactions deep — at 390px, with photographs on it.
- `test-in-a-browser`'s SKILL.md documents the new flags with a worked example
  against that flow, since it is the hardest case in the repository.
- The existing single-URL behaviour is unchanged for callers that do not pass
  the new flags.

## Related

Found while verifying B1803. Not caused by it: the script has always had this
limit, and the import is simply the first feature with enough screens behind
state to make it matter.

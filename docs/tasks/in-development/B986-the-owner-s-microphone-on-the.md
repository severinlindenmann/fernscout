---
id: B986
title: The owner's microphone on the search page is a full-width button asking about ASR languages and quoting a price
type: FEATURE
priority: high
complexity: low
area: search
found: "2026-09-08T16:34:20Z"
started: "2026-09-08T16:34:59Z"
session: 6c81e17b-6acf-4c0f-86ef-49124c9b2458
claimed: "2026-09-08T16:34:59Z"
---

# B986 — The owner's microphone on the search page is a full-width button asking about ASR languages and quoting a price

## Why

B981 mounted `RecordButton` on the search page in its full-width form, which
is the shape built for the wizard's words step — where speaking *is* the step.
On a search page it is wrong in four separate ways, and the owner said so:

- **It sits under the field as a full-width bar** where the browser's own
  microphone sat *inside* the field, on the right. The control that fills a
  box belongs in the box.
- **It asks which language you are speaking.** That question is B767's and is
  right where somebody is dictating a day they may well be narrating in
  another language. A search box is not that: the page already has a language,
  the reader chose it, and every language this transcriber supports is one the
  chrome is already in.
- **It quotes a price before every use.** Right on the wizard, where a person
  is deciding whether to dictate five minutes of prose. On a search box it is
  a price tag on a magnifying glass. The number a person actually needs is the
  one they are about to hit: **nothing at all until the balance is zero**, and
  then plainly.
- **The icon is a microphone**, which now says the wrong thing: since B981 what
  comes back does not fill the box, it goes to the agent. The control needs its
  own mark — microphone and agent in one.

## Work

- A drawing: `components/AgentMicIcon.tsx`, a microphone whose capsule carries
  the agent's spark, in `currentColor` at the same weight as the lucide icons
  beside it so it does not read as a foreign object. Checked at the size it is
  actually used, not at 200px.
- `RecordButton` gains two defaulted props — the icon its compact form draws,
  and the class its compact button carries — so the search page can put it in
  the field without a second implementation of holding a microphone.
- A `language` prop: when the host names one, the select is not drawn and that
  language is what is sent. The search page names the reader's own locale.
- The price line goes; the balance arrives from the server (owner only, and
  the same `balanceOf` `/me` reads) and says something **only when it is
  zero** — at which point the microphone is disabled rather than spending a
  press on a refusal.
- "Den Agenten fragen" stays exactly as it is.

## Acceptance

- On the search page, as owner: a single icon inside the field on the right,
  no language select, no price, and speaking still reaches the agent.
- With a zero balance: the microphone is disabled and says why.
- The wizard's own microphone is unchanged — same width, same price, same
  language select.

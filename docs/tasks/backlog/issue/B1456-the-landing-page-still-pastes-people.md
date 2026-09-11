---
id: B1456
title: The landing page still pastes people at the full guide, which is now a redirect to an index
type: ISSUE
priority: medium
complexity: low
area: landing, agent docs
found: "2026-09-11T12:34:26Z"
---

# B1456 — The landing page still pastes people at the full guide, which is now a redirect to an index

## Why

Found while building B311, and deliberately left out of it rather than absorbed.

B311 retired `/agent.md` — it is now a 301 to `/documentation.txt` — and split
the guide into nine task documents. The landing page's **pasted instruction**,
which is the one thing B261 established actually reaches a claude.ai-class
client, was not updated with it:

- `app/page.tsx` and `app/agent/page.tsx` both still pass
  ``agentUrl={`${site.url}/agent.md`}`` into the copy;
- `site/locales/en.json`'s `landing.instruction` still says **"the full guide at
  {agentUrl}"**.

Two things are now untrue in one sentence a person pastes into their agent. The
URL is a redirect rather than a document, and what it redirects to is an index
of 27KB rather than "the full guide" — the 149KB concatenation that phrase
described no longer exists at any address.

It is not broken for a client that follows redirects, which is why this is an
ISSUE and not a SECURITY or a high. It is wrong for the one that does not, and
wrong in its words for everybody.

The German `ownerPromptDe` string was already fixed to drop this pattern once
before, so this is the same fault surviving in the English copy.

## Work

Point the pasted instruction at `/documentation.txt` directly, and say what it
actually is. Consider naming a second URL — B261's finding is that a pasted
instruction may name more than one, and B311's own reasoning is that a
day-writing agent wants `/skill/add-a-day.md`; a list of nine is not something
anybody pastes, but two is.

Touches `components/AgentDoor.tsx`, `components/LandingSections.tsx`,
`components/Landing.tsx`, the three locale files, and the tests that currently
assert `/agent.md` appears there — `test/landing.test.tsx`,
`test/landing-metadata.test.tsx`, `test/signup-wizard.test.tsx`.

Not in scope: the comment-only `/agent.md` mentions left in `lib/api/entries.ts`,
`lib/api/auth.ts`, `lib/whatsapp/onboarding.ts`, `lib/ingest/video.ts`,
`lib/postcard/suggest.ts`, `lib/api/media.ts`, `lib/auth/index.ts`,
`components/InviteToRead.tsx`, `components/AgentHandover.tsx` and
`components/SignupWizard.tsx`. Those are stale prose in comments, harmless, and
worth a separate sweep rather than padding this one.

## Acceptance

- The instruction a person copies from the landing page names a URL that is a
  document rather than a redirect, and describes it truthfully.
- The same is true in German and Hungarian.
- `npm run verify` clean.

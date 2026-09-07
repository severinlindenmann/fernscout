---
id: B694
title: The landing page sends everybody off to fetch an agent of their own
type: FEATURE
priority: medium
complexity: low
area: landing, docs, i18n, agent
found: "2026-09-07T10:05:53Z"
started: "2026-09-07T11:27:36Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T11:27:36Z"
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

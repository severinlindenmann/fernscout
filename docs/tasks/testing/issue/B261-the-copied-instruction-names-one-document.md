---
id: B261
title: The copied instruction names one document, so the agent discovers the other one and is refused it
type: ISSUE
priority: high
complexity: low
area: landing page
found: "2026-09-04T11:00:53Z"
started: "2026-09-04T11:01:16Z"
merged: "2026-09-04T11:08:30Z"
---

# B261 — The copied instruction names one document, so the agent discovers the other one and is refused it

## Why

B259 found that a claude.ai chat client fetches only URLs the person typed or
that came from a search result: a URL discovered *inside* a fetched document is
refused, because a fetched page must not be able to send the fetcher wherever
it likes. Its own words for it:

> *"My permissions require that I find the URL in a search result first."*

That is correct behaviour and will not be relaxed. But it has a cheap way
around it that costs nothing and asks nobody to trust anything: **put both
URLs in the instruction the owner pastes.** `/documentation.txt` fetched fine
in both observed runs for exactly this reason — the owner had pasted it. Had
`/agent.md` been in the same pasted sentence, it would have had the same
provenance and the same permission.

The instruction (`landing.instruction`, added in B254, rendered and copied at
`components/Landing.tsx:111` and `:119`) names one document:

> Guide me through creating my own travel journal, following the documentation
> at https://fernscout.ch/documentation.txt. You will need an email address I
> control.

So the entry document's own first instruction — *read the guide at
/agent.md* — is the hop that fails, and it fails for a reason the copied text
could have prevented. B256 and B259 make the small document survive that
failure; this makes the failure not happen.

It does not fix everything: an agent whose fetch tool is GET-only still cannot
write, whatever it has read. That is B259's half.

## Work

- `landing.instruction` names both documents and says what each is: the
  overview at `/documentation.txt`, and the full guide with every call at
  `/agent.md`. Both as absolute URLs, so both carry provenance when pasted.
- `components/Landing.tsx` and `app/page.tsx:87`: the component takes one
  `docUrl` today. It needs both URLs. Pass what is needed rather than
  reconstructing a URL inside the component — `site.url` is already to hand in
  `app/page.tsx`.
- Keep visible and copied text identical, which is B255 — the block renders
  the same interpolated string it copies, from the same key. Two URLs in one
  mono paragraph must still wrap rather than scroll at 375px.
- All three locales, in the register each already uses.
- Keep it a short instruction, not a paragraph of prose. Whatever is added
  here is read by a weak model as its first input; the fewer sentences before
  the two URLs, the better.

Not in scope: `components/AgentHandover.tsx`, still — it hands over the guide
plus the owner's own address for a journal that already exists, and the
instruction it wants is different. Capture separately if it needs the same
treatment.

## Acceptance

- The copied value on `/` contains both `…/documentation.txt` and `…/agent.md`,
  and reads as one instruction rather than a list of links.
- Visible text is character-identical to the copied text (B255 holds).
- `test/landing.test.tsx` asserts both URLs are present in the copied value.
- No horizontal scroll on the section at 375px.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.

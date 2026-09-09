---
id: B1138
title: The WhatsApp channel discloses AI/consent once but never gates on an acknowledgement
type: ISSUE
priority: medium
complexity: medium
area: whatsapp, consent
found: "2026-09-09T20:17:00Z"
---

# B1138 — The WhatsApp channel discloses AI/consent once but never gates on an acknowledgement

## Why

B1058 (`lib/whatsapp/dispatch.ts`) sends a newly bound number a fixed first
message disclosing that it is an AI, which journal it writes to, and that
messages go to Meta and the model. The mockup this was built against
(`.claude/runs/2026-09-09-phone-and-gates/B1058/option-a.html`) ends that
message with "Reply 'yes' to continue" — an explicit consent gate. B1058's
build deliberately did not implement the gate, reasoning that there is
nothing downstream (B1056's model turn) yet to gate — see its ticket file's
"Built" section. That reasoning is sound for *why nothing broke*, but it
leaves a real gap: nothing tracks whether the disclosure was ever
acknowledged, so whoever builds B1056 either has to add this from scratch or
will ship a model turn that answers before anyone agreed to anything.

## Work

- Decide where acknowledgement state lives (a field beside
  `lib/whatsapp/binding.ts`'s greeted-marker is the natural place) and what
  "yes" matching looks like across three languages.
- B1056/B1061's model turn must check this state before running, not after.

## Acceptance

A newly greeted number that has not replied "yes" (or equivalent) gets no
model turn; one that has, does.

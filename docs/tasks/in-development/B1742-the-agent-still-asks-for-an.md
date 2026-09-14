---
id: B1742
title: The agent still asks for an email that is on the contact card the person selected
type: ISSUE
priority: high
complexity: low
area: helper, whatsapp
found: "2026-09-14T16:48:45Z"
started: "2026-09-14T16:52:37Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T16:52:37Z"
---

# B1742 — The agent still asks for an email that is on the selected card

## Why

B1737 shipped to fernscout.ch at 16:30 today. At 16:46, on the web, with
Viktória Zentai's contact card **selected in the files pane**, the exchange
was:

| said | answered |
| --- | --- |
| "auf ungarn reise" | "Du hast eine Kontaktkarte ausgewählt — Viktória Zentai. Soll sie als Buddy zur Reise **Ungarn 2026** hinzugefügt werden?" |
| "ja" | "Ich brauche noch Viktória Zentais E-Mail-Adresse, um sie zur Reise hinzufügen zu können. Steht sie auf der Kontaktkarte?" |
| "viktoriazentai96@gmail.com" | *(proposes `trip_people`)* |

The owner typed an address that was sitting in
`content/severin/inbox/contact/2b75b923bd22-vikt-ria-zentai.vcf`, three
metres of code from the tool that asked for it. That is precisely the
sentence B1737 existed to delete, and the answer even *names the card* while
asking.

**What is demonstrated:** the `tools` column of that `helper_sessions` row is
empty. `trip_people` was never called. The model did not try and fail to
resolve the card — it chose to ask instead of calling the tool at all. So
`stagedContact` is not implicated; nothing reached it.

**What is inferred, and needs proving before the fix is trusted:** that the
cause is the tool's own argument text. B1737's first draft told the model, on
the `email` property itself, *"Leave it out when a contact card waiting in
the inbox carries it: pass that card as contact instead."* That sentence was
cut during B1737's build because it pushed `test/helper-thread.test.ts`'s
prompt ceiling over, and what remains on `email` is the flat
`"Required before this can be proposed"` — which reads as *get an email
first*. The `contact` argument's own surviving description is ten words and
sits below it. The cut was mine and it is the obvious suspect, but a prompt
change is a behavioural claim and this one has not been run.

## What was measured, 2026-09-14

A probe drove the real `answerInThread` against a real model, with a journal,
a trip and a staged contact card, in the live two-turn shape: one short
message with the card selected, then "ja". Six runs per variant. The probe is
not in the repository — it makes paid model calls and reads nothing the suite
should read; it lived in the session scratchpad.

**The first three rounds of that probe were measuring the wrong thing, and
the conclusions drawn from them are void.** `answerInThread` does not compose
the selection line — `app/api/helper/[user]/ask/route.ts:334` does, and the
probe called `answerInThread` directly. So the model was answering without
ever being told which card was ticked, which is not the situation the owner
was in. Every comparison before that was fixed is discarded.

With the selection line present, as the web room really sends it:

| variant | proposed `trip_people` |
| --- | --- |
| as deployed | 4 of 6 |
| with the cut `email` sentence restored | 5 of 6 |

**So B1737 does work on the web, most of the time**, and when it proposes, the
address is filled from the card — the owner's failed attempt was the minority
outcome, not the only one. And the difference between the two variants is
inside the noise at six runs. The inferred cause in the Why above is therefore
**not established**, and the sentence was *not* restored: shipping a prompt
change that cannot be shown to be an improvement is the thing this ticket
already warned against.

Two other things the probe showed, both real and neither the reported symptom:

- The model sometimes reaches for the wrong tool entirely — `import_contacts`
  twice, `create_trip` twice (inventing a second Ungarn trip beside the one it
  had just read).
- The area router is not implicated: `pickArea` answered `trips` on both turns
  of every run, so `trip_people` was always in the tool list. The model had
  the tool and did not call it.

## Where this stands

**Not fixed, and left in `in-development` deliberately.** The acceptance below
cannot be demonstrated, and the honest reason is that the failure is a model
reliability problem at roughly one turn in three rather than a missing
mechanism. Nothing in this repository is currently shaped to fix that: a
prompt edit is the only lever, and six runs per variant is not enough
signal to choose one.

What would make it decidable, in rough order of value:

1. **A harness for this class of question.** Runs per variant in the dozens,
   several phrasings, a pass rate printed. Prompt changes are behavioural
   claims and there is no way to earn one today. This is the real ticket
   underneath this one.
2. Then, with that: test whether the `email` sentence, the `describeWaiting`
   wording, or a rule about answering one's own question actually moves the
   number.

A person should decide whether that harness is worth building before anybody
edits this prompt again.

## Acceptance

- With a contact card selected and no address typed, asking to add that
  person to a trip calls `trip_people` and proposes, with the address filled
  from the card. Demonstrated against a real model turn, not only a unit
  test.
- A test in `test/` that fails if the `email` and `contact` descriptions stop
  telling the model a card is a substitute for a typed address.

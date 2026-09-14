---
id: B1742
title: The agent still asks for an email that is on the contact card the person selected
type: ISSUE
priority: high
complexity: low
area: helper, whatsapp
found: "2026-09-14T16:48:45Z"
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

## Work

- **First, reproduce it and then prove the cause**, rather than restoring the
  sentence and hoping. Run the same turn against both argument texts with a
  selected contact card and no typed address, and record which one calls
  `trip_people`. One real model call each; anything less is a guess dressed
  as a fix.
- If the sentence is the cause, put it back, and pay for it honestly: the
  ceiling was raised to 8550 for B1737 and has ~24 tokens of headroom, so
  this needs either a further raise with its own paragraph or a real cut
  elsewhere. Do not shave the `contact` description again to fit — that is
  what produced this.
- Consider whether `email`'s "Required before this can be proposed" should
  simply stop being absolute now that it is not.

## Acceptance

- With a contact card selected and no address typed, asking to add that
  person to a trip calls `trip_people` and proposes, with the address filled
  from the card. Demonstrated against a real model turn, not only a unit
  test.
- A test in `test/` that fails if the `email` and `contact` descriptions stop
  telling the model a card is a substitute for a typed address.

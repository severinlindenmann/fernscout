---
id: B892
title: The helper does not look like a conversation anybody has had before
type: FEATURE
priority: high
complexity: medium
area: agent, ui
found: "2026-09-07T18:29:58Z"
---

# B892 — The helper does not look like a conversation anybody has had before

## Why

The owner asked for *"a bit more feeling like a chat session what people know"*.

B889 gives the helper a thread and answers in prose. What it looks like is
still a text box with an answer under it — the shape of a search field, which
is precisely the confusion a tester already had when she reached for Search
expecting it to do something (B844).

People know what a conversation looks like. They have used one every day for
fifteen years. Borrowing that shape is not decoration: it is the difference
between a person knowing they may say something else, and a person thinking
they have used up their one question.

## Work

The shape people already know, and no more of it than that:

- **Turns, stacked, in order** — what they said, what it answered, kept as they
  scroll. The thread already exists on the server after B889; this shows it.
- **A field that stays** at the bottom, ready for the next thing, rather than a
  box that resets and asks to be found again.
- **Something honest while it thinks.** It takes a second or two and silence
  reads as broken — the same fault B767 fixed on buttons.
- **The proposals from B891 render inside the conversation** as cards with
  their fields, not as a separate screen. That is what makes accepting,
  editing and ignoring all feel like the same conversation.

What NOT to borrow: avatars, a name, a personality, bubbles that imply somebody
is there. This writes in a person's journal; it should read as a tool that
speaks plainly, not a friend.

**Accessibility is not optional here.** B795 and B796 established that this
codebase loses focus and announces nothing on every state change. A conversation
is state changes: each answer must be announced once, the field must keep focus
after sending, and a screen reader must be able to read back what was said.
Build it in rather than filing it after.

**Mobile first at 390px**, where the keyboard takes half the screen — the field
must stay reachable with the keyboard open, which is the single thing chat
interfaces most often get wrong.

## Acceptance

Somebody who has used a messaging app can hold a conversation without being
told how, on a phone, and a screen-reader user can too.

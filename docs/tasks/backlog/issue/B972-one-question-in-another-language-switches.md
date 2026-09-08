---
id: B972
title: One question in another language switches the conversation into it for good
type: ISSUE
priority: medium
complexity: low
area: helper, i18n
found: "2026-09-08T13:59:02Z"
---

# B972 — One question in another language switches the conversation into it for good

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

One German question, and the rest of the conversation came back in German —
including the narration of a day the person had just described in an English
paragraph.

The prompt says *"Answer in prose, in the language they used."* With a thread,
"they" is ambiguous: the model can read it as the language of this message or
of the conversation, and it chose the conversation.

B921 settled the *furniture* — every string the server says follows the
journal's own language rather than the phone's. This is the other half and only
the model can decide it, because only the model has the text of what was just
said. A journal is one language; a bilingual owner asking one question in
another is not switching, and a person who does switch means it for that
message.

Small, and it is the kind of small that makes software feel like it is not
listening.

## Work

One clause in `threadSystemPrompt`: the language of their **latest** message,
whatever the earlier ones were in. B829 is the standing warning that prompt
wording is a weak lever, and it is also true that no code can decide this
better — language detection on one sentence is worse than the model's own
reading of it.

Watch the prompt budget (B930): it binds, and this is a few words.

## Acceptance

A German question in an English conversation is answered in German, and the
next English message is answered in English.

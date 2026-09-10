---
id: B1194
title: The STOP reply claims an unsubscribe that has not happened
type: ISSUE
priority: high
complexity: low
area: whatsapp, honesty
found: "2026-09-09T22:34:18Z"
merged: "2026-09-09T22:40:57Z"
completed: "2026-09-10T15:12:32Z"
---

# B1194 — The STOP reply claims an unsubscribe that has not happened

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Found while verifying run 2026-09-09-whatsapp-agent's report against the tree.
`wa.stopReply` (site/locales/en.json) opens with "You've been unsubscribed
from this journal's messages" — but `stopReplyFor()` (lib/whatsapp/stop.ts:57)
only builds the `/u/<token>` link, and `app/[user]/u/[token]/route.ts`'s GET
deliberately does not unsubscribe (link scanners would silently unsubscribe
people); the POST behind the button on the manage page is what does. So the
sentence is untrue at the moment it is sent — the same claim-versus-action
failure lib/helper/model.ts's net exists to catch, in a channel the net does
not cover because this string is fixed copy, not a model turn.

## Work

Reword `wa.stopReply` in en/de/hu to say what is true: the link is where they
stop the messages, one tap on the button there. No mechanism change.

## Acceptance

The reply to STOP promises nothing that has not happened; the word
"unsubscribed" appears only as something the link will do.

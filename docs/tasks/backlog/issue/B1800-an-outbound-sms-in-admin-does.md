---
id: B1800
title: An outbound SMS in /admin does not say which of the instance's numbers sent it
type: ISSUE
priority: low
complexity: low
area: admin, sms
found: "2026-09-15T14:20:00Z"
---

# B1800 — An outbound SMS in /admin does not say which of the instance's numbers sent it

## Why

`app/admin/page.tsx:380` renders a row as:

```
{sms.direction === "in" ? `from +${sms.from}` : `to +${sms.to}`}
```

So an outbound message shows only its recipient. That was complete while the
instance had one number. **Since B1791 it has two** — a Swiss Twilio number and
a UK one — and the operator cannot tell from the list which number a message
went out on.

It matters because the two numbers are not interchangeable: the Swiss one
reaches `+41` recipients only, the UK one sends internationally. When a
delivery is questioned, "which sender did this use" is the first thing to
establish, and the page cannot answer it.

**The data is already there.** `recordSms` stores `from_e164` on outbound rows
(`lib/sms/store.ts`), and `listSms` returns it as `from`. Only the rendering
drops it.

## Work

Show the sender on an outbound row as well as the recipient. Keep it readable
rather than doubling the line — the inbound form already reads `from +<n>`, so
an outbound row saying both sender and recipient should stay one line.

Check whether the operator can actually tell the two numbers apart at a glance
once shown; a bare E.164 pair may need a hint of which is which.

## Acceptance

An operator reading /admin's SMS list can tell which of the instance's numbers
sent each outbound message, without opening Twilio.

---
id: B1061
title: A conversation that goes quiet for a day cannot be answered, and nothing in the code knows it
type: FEATURE
priority: high
complexity: medium
area: whatsapp, policy, cost
found: "2026-09-09T07:11:44Z"
started: "2026-09-09T20:27:31Z"
merged: "2026-09-09T22:06:52Z"
completed: "2026-09-10T15:12:26Z"
---

# B1061 — A conversation that goes quiet for a day cannot be answered, and nothing in the code knows it

## Why

Meta's rule: a message from a person opens a **24-hour customer service
window**, and inside it a business may reply freely and at no charge. Outside
it, only an approved template may be sent, and each one is billed — for
Switzerland and Western Europe, around four to five euro cents.

The owner's expectation for this channel is *"free, because the user always
starts"*, and inside the window that is exactly right. It stops being right in
four places, and none of them is visible in the code today:

1. **A job that finishes late.** A photobook renders, a statement import
   completes, a weather lookup fills in. If the window has closed, the answer
   cannot be sent — not slowly, not at all.
2. **A conversation resumed the next morning.** The person messages first, so
   the window reopens and it is free. Fine — but only because *they* started.
   Anything that would have us speak first is a paid template with a
   twenty-four-hour lead time on approval and a name that is burnt for thirty
   days if deleted (`lib/whatsapp/settings.ts` is emphatic about this, from a
   day lost to it).
3. **The messaging limit.** B403 records this instance as business-unverified,
   which caps business-initiated conversations at 250 unique recipients per
   24 hours. Irrelevant at family scale, and worth writing down before it is
   not.
4. **What is actually free.** Delivery is. The model turn is not: `/ask` is
   deliberately unmetered (*"at roughly a third of a rappen a turn, metering
   the front door would cost more in people not daring to knock"*), but
   `write_day`, `describe_photos`, the statement mapping and transcription all
   spend the journal's credits, and they will spend them from WhatsApp too.
   "Free" is a claim about Meta's bill, not about the journal's balance, and
   somebody will read it as both.

## Work

- Make the rule explicit in code: **this channel never initiates.** Every
  outbound message is a reply inside an open window, and the send path refuses
  rather than silently falling back to a template.
- Track the window per conversation — the timestamp of the last inbound
  message is the whole of it — and let a caller ask whether it is open.
- Decide what a late answer does. The lazy option is that it waits: the answer
  is held and delivered the next time the person writes, with a line saying
  when it was ready. No template, no bill, no surprise.
- Say, in whatever copy introduces the channel, that messages are free and
  that writing a day up or transcribing a voice note still costs the journal's
  credits exactly as it does on the web.
- Capture the business-verification state in `docs/` beside B403 rather than
  in a comment that goes stale.

## Acceptance

Nothing in the codebase can send a WhatsApp message outside an open window
except the existing day announcement, which is a template and knows it; and a
test proves an answer produced after the window closes is held rather than
dropped or billed.

## Decided — 2026-09-09

Answered by the owner:

- **Never initiate.** Confirmed without exception — not even for a hard
  failure such as a photobook that could not be built. Every outbound message
  on this channel is a reply inside a window the person opened; an answer that
  becomes ready after the window closes is **held and delivered the next time
  they write**, with a line saying when it was ready.
- The day announcements to readers are unaffected and stay what they are:
  approved templates, business-initiated, and priced.
- The "free" copy must say what it means — Meta's bill, not the journal's
  balance. Writing a day up, captioning and transcribing spend credits from
  WhatsApp exactly as they do on the web.

## Decided further — 2026-09-09

- **A balance that runs out mid-conversation is said plainly**, in one
  sentence naming what the thing would have cost and what the balance is, plus
  a CTA URL button to the payment page. The refusal is already a documented
  error; this is only how it reads in a chat.
- **The request is not held across the payment.** Remembering what somebody
  asked for and doing it once they have paid is kinder and is state that has
  to survive a round-trip to a browser and back — and that could then act on
  an intention they have changed their mind about. Ask again after.

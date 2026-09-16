# The WhatsApp day funnel

*Written 16 September 2026, before the work. The record of intent, not of what
shipped.*

A styled version of this plan sits beside it as
`2026-09-16-whatsapp-day-funnel.html` — open it in a browser for the flow
drawn as a trail and the transcripts laid out as phone screens. The prose here
is the authority; the HTML is the same content, easier to look at.

## The decision

WhatsApp stops being an assistant that can do anything and becomes one thing
done perfectly: **capture and publish a single day of a trip.** Everything else
is recognised by name and handed to a web page.

This reverses the earlier promise of "no UI, just agents". That promise was
made on the assumption that a model could be trusted with the whole surface.
It cannot — not because the model is bad, but because `answerInThread()` offers
it roughly forty tools across seven areas on every inbound message, plus a
`switch_area` tool that can widen back to all of them. Forty ways to be wrong,
and one chance per message to pick right.

The funnel needs about six: resolve the day, stage files, read state, draft
words, polish on request, publish. **Most states run no model at all.**

## Why this is not only a preference

Four constraints decide most of the design. Three are Meta's.

### Meta's AI policy, in force since 15 January 2026

General-purpose AI chatbots are prohibited on the WhatsApp Business Platform.
AI is permitted only where the chatbot's role is *"ancillary to a legitimate
business service, not the centerpiece"*, and a clear handoff path to a human or
an alternative channel is required.

The current agent is on the wrong side of that line. The narrowing is the
compliant shape, and the redirects in `2026-09-16-capability-split.md` are the
required handoff.

Source: <https://respond.io/blog/whatsapp-general-purpose-chatbots-ban>

### The 24-hour customer service window

A window opens when the person messages the business number and lasts 24 hours
from their most recent message; every inbound resets it. Inside it, any
free-form message is allowed. Outside it, free-form is rejected outright and
only a pre-approved template can reopen contact.

So **the nudge lands at +20h or not at all.** A marketing template cannot
rescue a missed window: those are capped at roughly two per user per 24h across
all businesses, and marketing delivery to US numbers has been paused since
April 2025.

Source: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>

### Service messages become billable on 1 October 2026

Service messages (free-form replies inside the window) have been free since
1 November 2024. From 1 October 2026 they are charged, at the recipient
market's utility rate, **after a free monthly tier of 1,000 delivered service
messages per business phone number**. No rollover, no volume discount.

Only messages the business sends count; inbound is free.

**What this costs us, honestly.** A well-shaped capture sends three to five bot
messages per day. The free tier therefore covers roughly 200–250 captured days
a month across the whole instance, on one number. One person on a three-week
trip exchanging ten messages a day uses about a fifth of one month's
allowance. The pricing change does not threaten the product at this scale; it
makes "at most one ask per turn, at most two" an economic rule as well as a
courtesy one.

The exact Rest-of-Western-Europe rate (which is where Switzerland sits) was not
confirmed while writing this — Meta's public pricing page still says service
messages are free and the live rate sits behind an interactive widget. Read it
off the rate-card CSV in Business Manager before quoting a number to anyone.

Sources: <https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/>,
<https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026>

**Operationally more urgent than the price:** a business without a payment
method on file by 30 September 2026 has service-message delivery stopped
entirely on 1 October. B1791 records this failure mode having already bitten
this instance once.

### Interactive message limits

Reply buttons: **maximum three, titles maximum 20 characters**, titles unique.
A fourth option forces a list message, which reads as a form and does not
belong in a capture flow.

`Veröffentlichen` fits at 15 characters. `Jetzt veröffentlichen` at 21 does
not. This is a cheap keeper: assert every button locale key is ≤ 20 characters
across en, de and hu, and it fails the moment a translator writes the longer
phrase.

Source: <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages>

## The flow

Numbered states. Waymark numbers are referenced by the HTML version.

**S1 — something arrives.** Photo, voice note, text, or location pin proceed.
Contact cards, documents, stickers and videos redirect immediately; they have
their own pages now.

**S2 — which day this is.** Derived, never asked when it can be computed.

- Photo EXIF `DateTimeOriginal` wins when all photos agree on one date inside
  the trip. A photograph carries the truth; the message only carries when the
  person got to their phone.
- Otherwise the message timestamp in the journal's timezone, with 00:00–03:59
  meaning **yesterday** — somebody writing up at 01:30 means the day that just
  ended.
- The trip comes from `getCurrentTrip()` (`lib/trips.ts:914`), which already
  derives `current` from the date range via `deriveStatus()` and falls back to
  the most recently ended trip. **No new resolver is needed.** v2 `trip.json`
  stores no status field at all.

Exit: no trip, or a date more than three days before today → the files stay in
the undated inbox and the person gets a link to the page that assigns them.
Three days covers the flight home plus one jetlagged evening; past that the job
is backfill, which needs a calendar and belongs in a browser.

**S4 — ask which day, only when genuinely unclear.** Three buttons: `Today` /
`Yesterday` / `Another day`. "Another day" is an exit, not a fourth branch.

**S3 — the day folder opens.** `content/<user>/inbox/days/<date>/` — already
built, with `moveInboxFileToDay()` at `lib/inbox.ts:340`. Re-entering with more
photos just adds them; idempotent by construction.

**S5 — the mechanical draft.** Deterministic, no model, free:

- gallery = every staged photo sorted by EXIF time; cover = the first
- coordinates from EXIF GPS, else from a location pin, else empty
- `content` = voice transcript and text lines verbatim, in arrival order
- `title` empty unless the person supplied one
- `status: "draft"`

**An empty title beats an invented one.** Nothing here is written by a model,
so nothing here can be fiction.

**S6 — the gap check.** At most one question per turn, at most two in total,
in this order and skipping anything already answered or declined:

1. **Location** — only when no photo carries GPS and no pin arrived.
2. **Anything at all to say** — only when there is no text and no voice note.
3. **Title** — folded into the confirmation message, never its own turn.

Costs, transport, weather, tags and people are **never asked here.** They are
web fields. Every additional ask was another way to be wrong, and after
1 October each one is also a line item.

**S7 — silence.** Two asks sent with no answer: stop asking, send the draft
link, go quiet. Record the decline so the question is never repeated for that
day.

**S8 — the draft link, always.** Sent whatever happens, with a one-line
inventory of what actually went in: "12 photos, a 40-second note, no location."
This is simultaneously the handoff Meta requires and the escape hatch the
conversational-design literature recommends.

**S9 — the polish offer.** The only paid step. Offered once per day folder,
priced before the spend: writing prose from the transcript
(`WRITE_DAY_CREDITS`) and describing photographs. Short on credits → say so,
and the free draft still publishes. **The free version is never a hostage.**

**S13 — one nudge, at +20h.** Inside the person's own window so it is
free-form, only when a gap is open and the draft unpublished. Window closed →
send nothing; the draft waits on the web. The message says so out loud: *"That's
the only reminder I'll send."* Never a second.

**S10 — publish.** Owner only, consent explicit and in words. The bot restates
what is about to go live, then offers the button **in a separate message**. A
thumbs-up is not consent; silence is not consent; "looks good" is not consent.
Afterwards it reports what the call returned — never "published!" because it
was asked for.

## The day folder is the session

The 24-hour thread TTL (`lib/helper/thread.ts:110`) stops mattering the moment
conversational memory is no longer where state lives. A dropped thread loses
turns and loses nothing else: the next message resolves to the same date, opens
the same folder, reads the same file and carries on.

Today `inbox/days/<date>/` already holds staged files with `.meta.json`
sidecars, `day.json` (`DayReadiness`) and `words.md`. Three fields are missing,
and they go on the existing `day.json` through the existing merge-patch writer
in `lib/dayReadiness.ts`:

```jsonc
{
  "funnel": {
    "stage": "collecting" | "drafted" | "ready" | "published",
    "asked": "location",          // so an expired thread does not re-ask
    "asksSent": 1,
    "nudgedAt": null,
    "draftWords": {               // draft_words writes nothing today, so a
      "title": "…",               // draft dies with the thread and the
      "prose": "…",               // credits were spent for nothing
      "warnings": []
    }
  }
}
```

No new file format. No new writer.

## Restricting the tool set

`answerInThread()` already takes a `channel: "web" | "whatsapp"` parameter, but
it is used for one honesty-guard branch and is not read anywhere near
`activeAreas`. `runTool()` takes no caller or channel argument at all and looks
names up in the full flat `TOOLS` array.

Three changes, in increasing order of how much they matter:

1. Restrict the candidate areas before `pickArea()` runs, so the picking round
   cannot choose `printed` or `journal`.
2. Narrow `SWITCH_AREA_TOOL`'s enum and description to match, so the model is
   not told about areas it cannot reach.
3. **Refuse in `runTool()` on caller kind.** This is the only one that is
   actually a boundary — a tool list offered to a model is advisory, and
   `switch_area` can currently widen back to everything.

Watch the prompt cache: a six-tool list will likely fall under Haiku's
4,096-token cache floor, silently losing the saving. The `readers` area already
measures ~3,990, under the line. Measure rather than discover.

## Publishing already works — leave it alone

`publish_day`'s proposal targets `app/api/helper/[user]/day/publish/route.ts`,
which authenticates through `isHelperOwner()`. That accepts a `whatsappCaller()`
as owner-equivalent, so publishing from chat works today.

The v2 route (`app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route.ts`) is
**unreachable from WhatsApp** — it authenticates via `resolveBearer()` and
`mayActAsOwner()`, and no code path connects the `AsyncLocalStorage` caller to a
bearer `Session`. Migrating to it would mean changing `mayActAsOwner`, which is
a safety shape and needs the security review path, for no user-visible gain.

**The recommendation is to do nothing here.**

## Transcripts

Tone rules, held throughout: state only what arrived; name what is missing
rather than filling it; one ask per turn. No exclamation marks, no "Great!", no
invented place, meal, weather or feeling.

### Happy path

> **Him** *[12 photos, 19:42]*
>
> **Fernscout** — Got 12 photos. Give me a moment.
>
> **Him** *[voice note, 0:47]*
>
> **Fernscout** — Transcribed your note — that spent 1 credit.
> The photos are dated 14 September and eight of them have GPS, all in
> Kanazawa. I've put them on that day.
> fernscout.ch/severin/japan-2026/2026-09-14
> Cover is the first photo of the day. Title is empty.
>
> Want me to write the day up from your note? That's 4 credits. Without it the
> note goes in as you spoke it.
> *[Buttons: `Write it up` · `Leave as spoken` · `Not now`]*
>
> **Him** — Write it up
>
> **Fernscout** — Done — 4 credits, 38 left.
> Title: "Kanazawa, the long way round". The text is from your note, nothing
> added.
> It's a draft. Nobody can see it yet.
>
> **Him** — that's good. publish it
>
> **Fernscout** — Publishing 14 September, "Kanazawa, the long way round",
> 12 photos, to your journal at fernscout.ch/severin.
> *[Buttons: `Publish it` · `Not yet`]*
>
> **Him** — *[taps `Publish it`]*
>
> **Fernscout** — Published. It's live at
> fernscout.ch/severin/japan-2026/2026-09-14.

### Location gap

> **Him** *[6 photos]*
>
> **Fernscout** — Got 6 photos, dated today.
> None of them carry GPS, so I don't know where you were.
> Send a location pin, or just tell me the place.
>
> **Him** — somewhere up above Wengen, I don't know the name
>
> **Fernscout** — I'll put "above Wengen" as the location and leave the
> coordinates empty — you can drop an exact point on the page later.

It writes his words. Not a guessed summit, not a guessed trail.

### Redirect, mid-conversation

> **Him** *[contact card]*
>
> **Fernscout** — I only do days here — one day at a time, photos and notes.
> People go on fernscout.ch/severin/people, and invites are on
> fernscout.ch/severin/readers.
>
> Back to 14 September: still no location on it. A pin or a place name and it's
> done.

The boundary, the link, then straight back to the open job. No apology, no
offer to try anyway.

### Out of credits

> **Fernscout** — Got 7 photos and your note, on 16 September.
> Writing the day up from your note is 4 credits. Your balance is 1.
> The draft stands either way — your note is in it word for word, and you can
> publish it as it is.
> *[Buttons: `Publish as it is` · `Top up`]*

### Silence, and the one nudge

> **Fernscout** *[Tuesday 20:15]* — Got 11 photos, dated today, all with GPS in
> Hakone. Filed on 15 September. No title and nothing written yet. Tell me
> about the day whenever you like.
>
> *[silence]*
>
> **Fernscout** *[Wednesday 16:15, +20h, inside his window]* — Yesterday's 11
> photos from Hakone are still a draft with nothing written on it.
> Send me a voice note and I'll write it up, or finish it here: …
>
> That's the only reminder I'll send.
>
> *[silence — and nothing further, ever]*

### The same, in German

> **Fernscout** — Deine Notiz ist transkribiert — das hat 1 Kredit gekostet.
> Die Fotos sind auf den 14. September datiert, acht davon mit GPS, alle in
> Kanazawa. Ich habe sie auf diesen Tag gelegt.
> Als Titelbild das erste Foto des Tages. Der Titel ist leer.
>
> Soll ich den Tag aus deiner Notiz ausformulieren? Das kostet 4 Kredite. Ohne
> das steht deine Notiz so drin, wie du sie gesprochen hast.
> *[Buttons: `Ausformulieren` · `So belassen` · `Jetzt nicht`]*

Button lengths checked: `Ausformulieren` 14, `So belassen` 11, `Jetzt nicht`
11, `Veröffentlichen` 15, `Noch nicht` 10. All within 20.

## Deliberately not done here

- **Hungarian.** Every fixed string above needs a real `hu` entry. Nobody who
  wrote this plan has working Hungarian, and AGENTS.md forbids inventing a
  translation. This is a hand-off to a speaker, not a to-do.
- **A utility template for the closed-window case.** Currently: send nothing.
  An approved utility template would allow one late nudge, at the cost of an
  approval cycle and a real per-message fee. Not proposed.
- **Costs and people on WhatsApp.** Deliberately dropped from the chat; see the
  redirect table in `2026-09-16-capability-split.md`.

## Open questions

- Is three days the right tail for "the trip just ended"?
- Does the funnel ever ask for a title, or is that always the page's job?
- Should the funnel carry a per-day message budget once service messages are
  billable?

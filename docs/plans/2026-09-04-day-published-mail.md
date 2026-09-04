# A letter when a day goes up

*Written 2026-09-04, before the work, as the record of what was intended. Not
corrected afterwards — see `docs/README.md`.*

## What was asked for

When a day is published, everybody who may read it — guests, the people on the
trip, and the owner — gets a letter carrying that day: its title, its words,
its photograph, where the traveller was, what time it is there, what the day
cost, and a link to the place on a map.

Two triggers, both explicit:

- `send_mail: true` on `POST .../days/<slug>/publish`.
- A separate call to send the letter for a day that is **already** published,
  so one can be sent again.

## The most important thing about this feature

**It is not a new mail system.** `lib/digest/` already resolves recipients,
filters by what each may read, picks each reader's language, respects quiet
hours, records what was sent to whom, and puts an unsubscribe link in every
letter. That machinery is the hard part and it exists.

So this is **a second trigger on the digest's machinery**, with a richer
single-day payload. Anything below that duplicates `lib/digest/` is a mistake,
and the first review question should be "why is this not calling that".

What is genuinely new: the payload (one day in full rather than a list of
links), the trigger (a write, not a schedule), and the resend.

## Who receives it

Reuse, do not reinvent:

- `contactsWithReadGrant` (`lib/grants.ts`) — the journal's approved contacts.
- `digestableTrips` (`lib/digest/visibility.ts`) — what each may actually read.
- The people on the trip: `peopleOf()` merges `people:` in `trip.md` with the
  rows a buddy link created (AGENTS.md).
- The owner, always — it is their journal and their record that it went.

Three filters that must hold, and each is a way this feature could hurt
somebody:

1. **A day in a `private` trip goes only to the people on that trip.** A guest
   of the journal is a guest of the journal, never of one trip.
2. **`wants_email_digest` is an opt-in and this is mail.** A reader who turned
   the digest off did not ask for more letters because a different code path
   sends them. If a day-letter is meant to be separately switchable, that is a
   second column and a second question on the redeem form — decide, do not
   assume.
3. **`test: true` days send nothing.** Content nobody lived must not arrive in
   anybody's inbox. This is the one rule and it is not negotiable.

## What the letter contains

Per recipient, in **their** language — which is now possible because B294
requires a day to carry every language the journal declares. `pickLocale`
already chooses per reader.

| Piece | Source | Note |
| --- | --- | --- |
| Title | `entry.title`, or `translations[locale].title` | B294 |
| The words | `entry.content` / its translation | See "how much" below |
| Photograph | `entry.gallery[0]` | **Attached, not linked — see below** |
| Where | `entry.location`, `entry.country` | Plain text |
| Map link | `entry.lat`/`lng` | Only when both are present |
| Local time | timezone for the day's place | See "the time" below |
| What it cost | `costForDay` | **Only for readers who may see costs** |
| A link to the day | the day's URL | The point of the letter |

### The photograph is the hard part

`app/[user]/media/[...path]/route.ts` gates every image on `mayReadTrip(trip)`.
A mail client carries no session cookie, so `<img src="https://…/viki/media/…">`
is **404 in the inbox** for every `guest` and `private` trip — which is most of
them. A linked image would work only for public journals, which is the case
that needs it least.

So: **attach the photograph to the letter** (inline, referenced by `cid:`), or
send no image. Derivatives are ~35 KB, so one per letter is affordable. The
alternative — a signed, expiring media URL — is a new credential shape for a
problem an attachment already solves, and should not be built without a reason
attachments cannot cover.

Send one photograph, not the whole gallery. A day with nine pictures becomes a
letter nobody opens on a phone.

### The time, and what it actually means

"What time is it there" needs a timezone for the day's location.
`lib/digest/quiet.ts` has `journalTimezone()` and `timezoneFor(locale)` — both
about the *reader*, not about the place in the photograph. Deriving a timezone
from `lat`/`lng` needs a lookup this project does not have.

Options, cheapest first: the trip's own timezone if one is recorded; the
journal's; or say the local date rather than the local time, which needs no
lookup and is what a reader actually wants ("Tuesday evening in Hanoi"). Decide
before building — a wrong clock is worse than no clock.

Note also that the day being published is often **not** today. A letter saying
"it is 9pm there" about a day written three weeks ago is wrong in a way nobody
will report.

### Costs are gated, per reader

`mayViewCosts(trip)` and `costsVisibility` already decide who may see a trip's
numbers. The letter must ask that question **per recipient**, not once. A guest
who may not see spend on the site must not receive it in an inbox, where it is
permanent and forwardable.

### How much of the words

A day can be a hundred words or three thousand. Send an opening — the first
paragraph or a few hundred characters — and a link, rather than the whole
entry. A letter is an invitation to read, and the full text in mail loses the
photographs, the map and the layout that make the day worth reading on the
site.

## Formatting

`lib/mail/template.ts` renders blocks (`paragraph`, `button`) into the same
shell every letter here uses. This needs:

- an **image block** (inline attachment, alt text from the caption),
- a **detail line** — place, local date, cost — as small type under the title,
- the existing button, pointing at the day.

Keep the shell. Four letters already share it and a fifth that looks different
is a fifth that has to be maintained separately.

Plain-text alternative is not optional: `renderMail` already produces both, and
the text part must carry the same facts — including the map link, which is the
one thing a text reader most wants.

## The two triggers

**On publish.** `send_mail` is a parameter of the publish call, and its
absence means no letter. It must not default to true: publishing is already
the irreversible step, and an agent that publishes fifteen days would
otherwise send fifteen letters to everybody the owner knows. The publish
response must say plainly how many letters went and to whom — the count, not
the addresses.

**Afterwards.** `POST .../days/<slug>/send-mail` (name it in the ticket) for a
day already up. This is the "send it again" path and it exists because the
first send can fail, or an owner can decide afterwards that a day is worth
announcing.

Both are the **owner's** decision. A trip-scoped token writes days into its
trip and cannot publish them (B28); it must not be able to mail the journal's
whole readership either.

## Not sending twice by accident

`digest_sends` already records one send per contact per channel. Use it, with
a channel of its own — the schema comment says `digest | push | print | …`.

The rule: the publish trigger sends **once**, and a second publish of the same
day sends nothing. The explicit resend sends **regardless**, because that is
what it is for, and it should say in its response that it is a resend.

Mail is best-effort throughout — B272 was a production failure where an
unguarded send turned a successful confirmation into "that code didn't work".
A letter that fails must not fail the publish, and the failure must be visible
in the response rather than only in a log.

## What this plan deliberately does not do

- **No live location.** The letter says where that *day* was, from the day's
  own coordinates. Nothing here should imply the traveller's current position,
  and no reader should be able to infer it from a published day about last
  Tuesday.
- **No new recipient list.** If somebody is not already a contact with a read
  grant or a person on the trip, this feature does not reach them.
- **No batching, no scheduling, no quiet hours.** Those are the digest's, and
  this letter is a direct consequence of an owner pressing publish. If quiet
  hours should apply, that is a decision to record, not a default to inherit.

## Open decisions, for the owner

1. Is a day-letter separately switchable from the digest, or does
   `wants_email_digest` cover both?
2. Local time, or local date only?
3. One photograph, or none, or the first three?
4. Does the resend also go to people who already received it, or only to those
   who did not?

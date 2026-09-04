---
id: B321
title: A contact row shows the raw invite id it came from, not which link or which trip
type: ISSUE
priority: low
complexity: low
area: contacts, ui
found: "2026-09-04T17:02:11Z"
started: "2026-09-04T17:16:18Z"
session: cae3e4fb-d628-4a89-89b7-43a581bc7e71
claimed: "2026-09-04T17:16:18Z"
---

# B321 — A contact row shows the raw invite id it came from, not which link or which trip

## Why

Found from the live instance, beside B320. Every row on `/{user}/contacts`
renders a line labelled *"Gekommen über"* whose value is a UUID:

```
Gekommen über
invite:1529b564-abd1-4f47-8735-17675e660b7c
```

`components/ContactsAdmin.tsx:162` is `<dd>{contact.createdVia ?? "—"}</dd>`.
`createdVia` is provenance the database stores for the code's benefit —
`invite:<id>` | `open` | `owner`, per `lib/db/schema.ts:141` — and it is being
printed at a person.

The label promises the useful thing and the value withholds it. What an owner
wants from *"came in through"* is **which link**, and for a buddy link
**which trip** — that is the difference between a reader of the journal and
somebody who may write days into `asien-2025`, and it is the single most
important fact about a contact row. The invite record has both: `kind` and
`tripId` are on `Invite`, and B97 has just put them on the *invite* list for
exactly this reason. The contact list is the other surface and did not get
them.

The UUID is not merely unhelpful, it is the same for every contact who used one
link, so three rows reading `invite:55e41d81-…` look like three unrelated
strings rather than "these three came in on the same family link".

Cost is small and steady: an owner deciding whether to revoke somebody cannot
tell from the row what they would be revoking, and has to compare a UUID
against the invite list by eye.

Related: B97 (same distinction, invite list, in `testing/`), B320 (the buddy's
own side of the same missing fact).

## Work

Resolve `createdVia` against the invite record before it reaches the component,
and render the kind — and the trip, when there is one — instead of the id. A
revoked or deleted invite still has to render something honest; fall back to a
plain "an invite link" rather than reinstating the UUID. `open` and `owner`
already read as words and should keep doing so.

Whether to keep the id visible at all is a judgement: it is diagnostic value
for nobody who reads this page. Prefer dropping it; if it is kept, it belongs
behind something, not as the value of the line.

Not doing: any change to what is stored — `createdVia` stays as it is, this is
a rendering fix.

**Two things learned while building.**

*No server change was needed at all.* `ContactsAdmin` already holds the
contacts, the invites **and** the trip titles in its own state — the invites
because B97 put them there, the titles because the form that makes a buddy link
offers them in a dropdown. So the resolution is a lookup in the component, and
`refresh()` keeps it current when a link is revoked. Nothing new is fetched and
no route changed.

*The id was decided against, and the title used instead.* The Work above said
"which trip" without saying in whose words. The owner picks a trip from a
dropdown of **titles** and was then shown `asien-2025` everywhere afterwards,
so the title is the answer, falling back to the id when a trip has been renamed
or deleted since.

That made the invite list one line's worth of inconsistent — it has printed the
bare id since B97 — so it now uses the same `tripLabel`. One substitution,
taken here rather than captured, because the inconsistency would have been
*introduced by this change*: two lists on one page naming one trip two
different ways is worse than what either said before.

## Acceptance

- A contact who arrived on a buddy link shows which trip that link was for,
  by its title.
- A contact who arrived on a guest link says so, without a UUID.
- A contact whose invite has since been revoked or deleted still renders a
  sentence rather than an id or an empty line.
- The invite list beside it names the same trip the same way.

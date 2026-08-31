# W26 — People on a trip

## Why

A trip is currently one journal's property: the owner writes it, everyone else
reads it. But trips are taken together, and the person sitting next to you on
the bus has as much right to write the day up as you do.

## The model

A **person** is a name and an email address. The email is the identity —
there is no separate username to invent, and it is already what
`/api/auth/request` sends a code to.

> **Decision.** "The username is the email address" is read as *people are
> identified by email*, not as *journal directories get renamed*. A journal
> directory is a URL segment and a filesystem path, and therefore a security
> boundary with a strict character set; an email address is neither. The
> journal stays `content/<username>/`; the people on a trip are emails.

```yaml
# trip.md
people:
  - { name: "Alex Berger", email: "alex@example.com" }
  - { name: "Robin Berger", email: "robin@example.com" }
```

- **Solo** is zero or one entry. **Two to ten** is the supported range; more is
  rejected at parse time with the count, because a trip with fifty "people" is
  a mailing list and this is not one.
- The journal's `ownerEmail` is a person on every trip in it, listed or not.
- A person on a trip may obtain an **agent token scoped to that trip** and has
  full edit rights over the whole of it — every day, not only their own.

## Work

1. `people:` parsed in `lib/trips.ts`, typed, validated (2–10, valid address,
   no duplicates), with a fail-closed default of "just the owner".
2. `lib/trips/people.ts` — `peopleOf(trip)`, `isPersonOn(trip, email)`.
3. `app/api/auth/request` issues a token to a **person on the trip**, not only
   to `ownerEmail`. The token carries the trip it is scoped to.
4. `resolveSession` grows a trip scope; `isOwner` keeps meaning *the journal's
   owner* and a new `mayEditTrip(trip, session)` means *a person on it*.
5. The REST and MCP write paths accept a trip-scoped token for that trip only.

## Acceptance

- A listed person gets a token by email and can create a day on that trip.
- The same token is refused on every other trip, including in the same journal.
- Eleven people fails the parse, naming the count.
- A journal with no `people:` behaves exactly as it does today.

## Stop line

Do not build a UI for adding people. It is frontmatter, like everything else.

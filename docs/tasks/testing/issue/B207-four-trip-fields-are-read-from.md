---
id: B207
title: Four trip fields are read from trip.md and nothing can write them
type: ISSUE
priority: low
complexity: low
area: trips, api
found: "2026-09-04T06:14:14Z"
started: "2026-09-04T08:57:03Z"
merged: "2026-09-04T09:30:13Z"
---

# B207 — Four trip fields are read from trip.md and nothing can write them

## Why

B178 asked for a check of the rest of the parsed frontmatter once
`costsVisibility` had been closed, on the grounds that two such gaps had
turned up in one day and a third would not be a surprise. There are four.

`KNOWN_TRIP_FIELDS` in `lib/trips.ts` is the whole vocabulary of a `trip.md`.
`createTrip` (`lib/tripWrite.ts`) now writes `id`, `title`, `tagline`,
`start`, `end`, `status`, `accent`, `visibility`, `listed`, `costsVisibility`
and `test`. It has never written, and neither door has ever accepted:

- **`people`** — the significant one. It is who took the trip, and per
  AGENTS.md everyone listed *may write to the whole trip* and *may hold an
  agent token scoped to it*, as well as being the byline. An owner working
  through an agent — the only way this product is written — cannot put anybody
  on a trip. The buddy-link flow (B33) adds rows that `peopleOf()` merges, so
  there is a second route to write *access*; there is no route at all to the
  credit, which is rendered from the file alone.
- **`cover`** — the trip's cover image.
- **`rates`** — this trip's frozen local→base currency table. Without it every
  foreign-currency cost in the trip is read in the base currency.
- **`translations`** — the trip's title in the journal's other locales.

Each is read, typed and rendered; none can be produced by any means the
product offers. `people` is the one with a real consequence and the other
three are the same shape.

## Work

- Decide each separately rather than adding four properties at once. `people`
  is the one worth arguing about: it grants write access, so accepting it on a
  create is handing an agent the ability to widen who may write, and it may
  belong on an owner-only update path rather than on create.
- Whichever are accepted go on **both** doors — REST body and MCP
  `inputSchema` — with the round-trip asserted, as B178 did.
- `rates` and `translations` are maps rather than scalars, so they need a
  shape check before they reach the frontmatter writer, not just a quote.

Not doing: a general trip-update endpoint. That is a bigger question than this
capture, which is only about the fields the reader already understands.

## What was done

Four decisions, one per field. Three writers and one reasoned no.

**`people` — accepted, on create, owner only.** This is the one the ticket said
to argue about, and the argument came out the other way from where it started.
Accepting it does hand an agent the ability to say who may write — but
`createTrip` is already refused to a trip-scoped token, so the authority being
spent is one that could already write anything in the journal; and a trip made
by this call is *empty*, so there is no existing content for a name to widen
access to. Naming an address grants nothing on its own either: whoever holds it
still has to prove it through `/api/auth/request`. What is left is the byline,
which `peopleOf()` renders from the file alone and which had no route at all.

Changing the list on a trip that already holds days is the case this is not,
and it is the one worth the caution the ticket had — captured as **B245**.

Validated in `peopleBlock` (`lib/tripWrite.ts`) and **refused, never dropped**:
`parsePeople` fails closed because a reader has nobody to tell, and a writer
does. `PERSON_EMAIL_RE` is now exported from `lib/trips.ts` so the two agree
about what an address is — the three-regex problem that turned up while doing
it is **B247**.

**`rates` — accepted.** Nothing about it has to wait: the number is a judgement
about what the trip cost (B17), and whoever writes the trip up either holds it
or does not. Both doors carry the direction in words, because it is the mistake
the model invites — units of the base currency for one unit of the keyed
currency, so a currency worth less than the base one gets a small number. A
value only expressible in exponent form is refused rather than written, because
`String(1e-7)` is `"1e-7"` and YAML reads that back as text.

**`translations` — accepted, for locales the journal declares.** A translation
into a language nothing renders is the inert write B182 refused to ship, so a
locale outside the journal's `locales` is refused and the message names the
call that adds one — which since B220 exists.

**`cover` — no, and this is the decision rather than an omission.** At the
moment `createTrip` runs the folder is being made: `media/` does not exist, and
`POST /api/v1/<user>/trips/<trip>/media` refuses a batch that does not name a
day, so no photograph can arrive until a day has. Any value a caller could send
would name a file that is not there, and the trips index and the OG card would
draw a broken image rather than nothing. It stays file-only;
`.claude/skills/add-a-trip/SKILL.md` now has the `cover:` bullet saying how to
write it by hand and why no call takes it, and **B245** is the call it belongs
on.

Written down in three places, not one: `NewTrip` in `lib/tripWrite.ts`, the
skill, and `/agent.md`.

### Where

- `lib/tripWrite.ts` — `peopleBlock`, `ratesBlock`, `translationsBlock`,
  `yamlNumber`, validated before `mkdirSync` so a refusal never leaves a folder
  behind (B204's lesson); the `cover` decision in the `NewTrip` docblock.
- `lib/trips.ts` — `PERSON_EMAIL_RE` and `KNOWN_TRIP_FIELDS` exported.
- `lib/locales.ts` — `LOCALE_TAG_RE`, one copy shared with B220's writer.
- `app/api/v1/[user]/trips/route.ts:117` and `lib/mcp/tools.ts` (`createTripTool`
  and the `create_trip` `inputSchema`) — the two doors.
- `/agent.md` (`lib/api/documentation.ts`) and `/openapi.json` document all
  three, and say there is no `cover`.

### Evidence

- *"For each of the four, a writer with a round-trip test, or a sentence saying
  why it stays file-only."* — `npx vitest run test/journals.test.ts -t "the
  trip fields that had no writer"`: 16 tests, and the same 14 fail against
  `git show HEAD:lib/tripWrite.ts`. The both-doors round trip is
  `test/mcp.test.ts`, "all three land in the file, read back, and both doors
  write it identically", which asserts the REST byte-for-byte equal to MCP's.
  `cover` has the sentence above, the skill bullet, and two tests that no door
  offers it.
- *"Nothing in `KNOWN_TRIP_FIELDS` is left undecided."* — asserted rather than
  claimed: `test/journals.test.ts`, "every field the reader knows is now either
  written or decided", holds the written list plus the one decided against
  against the exported set, so a fifteenth field added without a decision fails
  the suite.
- `npm run build` ✓, `npx tsc --noEmit` ✓, `npx eslint .` 0 errors (4
  pre-existing warnings), `npx vitest run` 2270 passed / 3 skipped.

### Captured, not absorbed

**B245** (a trip.md cannot be changed after creation — the home for `cover` and
for correcting the other three), **B246** (`/openapi.json` never documented
B178's `costsVisibility` on this endpoint), **B247** (three regexes for an email
address, two of which disagree).

## Acceptance

- For each of the four, the file records either a writer with a round-trip
  test, or a sentence saying why the field stays file-only and where a person
  is told to hand-edit it.
- Nothing in `KNOWN_TRIP_FIELDS` is left undecided.

---

**2026-09-04, checked on fernscout.ch (e85248d): one of the four is now
writable.** B352 added `GET`/`PATCH /api/v1/<user>/trips/<trip>/rates`, so
`rates` has a door. The rest still have none — `PATCH /api/v1/<user>/trips/<trip>`
answers `method_not_allowed` ("This route takes DELETE and nothing else"), which
is also why **B178** still stands: `costsVisibility` is read from `trip.md` and
no call writes it.

Left in `testing/`: the ticket is three fields now, not four.

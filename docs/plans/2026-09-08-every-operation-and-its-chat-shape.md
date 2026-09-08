# Every operation, and the shape it takes in a conversation

*A read-only survey made 2026-09-08, before the chat-first build. Seventy-two
documented operations, the helper's own seventeen, and the intent registry —
each mapped to one of seven render shapes, or to the reason it must not be
reachable from a conversation at all. Kept because the mapping is the design:
a tool declares how it renders, so this table is what the registry becomes.*

## The vocabulary, and why no eighth shape

`say`, `choose`, `form`, `preview`, `files`, `confirm`, `link`.

Two candidates were considered and rejected:

- **`record`** — speech is an *input* to the thread, not a result render.
  `POST /api/helper/<user>/transcribe` returns words and words render as `say`.
  The microphone belongs to the composer, not to a tool's answer.
- **`pending`** — `link` already covers "go somewhere and come back", and `say`
  covers "a mail is waiting". Inventing a shape for waiting is how a person
  ends up watching a spinner instead of reading a sentence.

One clarification that costs nothing: **`confirm` is what a proposal renders as
when there is nothing to correct; `form` is what it renders as when there is.**
They are one mechanism — a write that has not happened — differing only in
whether fields are shown. `preview` is its third face: the thing rendered as it
will look, with the same press underneath.

## What must never be a tool

Pre-session, credential-minting, credit-granting, unrecoverable, or a
whole-file replace:

`POST /api/auth/*`, `POST /api/v1/journals`, both handover routes,
`GET`/`POST /keys`, **`POST /payments/{id}/approve`** (the one call that grants
credits), `POST /deletions/{token}`, **`DELETE …/days`**, `PUT …/costs`, the
postcard send route, `DELETE /me/devices/{id}`.

Three deserve their reasoning repeated, because each is a place where "let the
chat do everything" would quietly file a safety off:

- **`DELETE …/days`** is unrecoverable *and* is the nearest neighbour to every
  takedown sentence. B817 is the record of what happens when removal language
  finds a write. Takedown in a conversation is `unpublish` and nothing else.
- **`POST /deletions/{token}`** is the mailed page's button. `lib/agentConfirm.ts`
  is deliberately not used for deletion because an agent could satisfy its own
  confirmation; a chat tool would be that failure by another route.
- **The postcard send route** is cookie-only, refuses bearers, and
  `test/postcard-orders.test.ts` fails if anything under `app/api` imports
  `sendOrder`. A conversation proposes; the owner presses on their own page.

## The count

**27 reads** that execute immediately — none of which reaches `lib/gps/store.ts`,
and a `trip_track` read is deliberately absent: the drawn line is a property of
the trip page, not a thing to be read out.

**41 writes**, every one returning a proposal and writing nothing.

**8 links**, handing off to a page that must stay where it is.

## The twelve for day one

Chosen against what seven testers actually did, not against the capability
matrix:

`trips`, `days`, `read_day`, `account`, `create_trip`, `start_day`,
`draft_words`, `set_day_words`, `add_photos`, `add_cost`, `publish_day`,
`unpublish_day`.

Notice what they are: rounds 1, 2 and half of 3 of the completeness plan, plus
the four sentences the owner measured as `unknown`. **Nothing is on the list
because the API happens to have it.**

Two of the remaining forty should jump the queue the moment those are green:
`invite_guest` (B799 shipped the day page; the conversation still has no row)
and `remove_photo` — the friend who asks to come out of a photograph is asking
about a picture, not a day.

## The rule that outranks the ordering

**A sentence in a territory with no tool gets a named refusal, never the
nearest neighbour.** Twelve tools with an honest "I cannot do that here" beats
fifty-two with a confident wrong one. If the loop starts proposing the wrong
tool confidently, the answer written down in advance is *fewer tools, not
better prompts*.

## Eleven gaps in the API itself

Found by asking what a conversation needs and discovering no route provides it.
Each is now its own ticket where it earned one.

1. **`plan.md` has no route at all.** `lib/plan.ts:57` reads it from disk,
   `lib/contentModel/document.ts:283` has rules for it, nothing under `app/api`
   touches it. An upcoming trip's whole intended route is unreachable.
2. **There is no API unpublish.** `DayEdit` carries `title`, `date`, `content`,
   `costs`, `weather`, `test` — and no `status`. Taking a day off the site
   exists only on the helper's cookie-only route. **An agent over the network
   can publish and cannot unpublish**, which is a gate backwards.
3. **Trip `PATCH` accepts five fields; `POST` accepts seventeen.** `intro`,
   `accent`, `status`, `listed`, `teaser`, `costsVisibility`, `test` are
   write-once. A typo in a trip's intro is permanent without a shell.
4. **No `GET` on a trip's media.** `POST` and `DELETE` exist; nothing lists.
   A `files` shape needs a listing.
5. **Approved contacts are not in `/api/v1`.** `GET /invites` lists links
   *issued*; who was actually approved is an undocumented cookie route.
6. **No agent-token revocation.** `GET /keys` lists, `POST /keys` issues, and
   there is no `DELETE`. A leaked seven-day token can be listed and not ended.
7. **No search.** Nothing answers "the day with the photo of Anna" — the exact
   sentence from B817. Every day-finding tool resolves by date or slug, and the
   sentence people actually say names a thing.
8. **No "which days were never written"** — derivable, and computing it in
   three places is how it comes out different in three places.
9. **Photobooks can be printed and not built.**
10. **`/api/health` publishes upload limits and not credit prices**, so no
    caller can read the price before spending.
11. **Nothing reports what a helper turn cost**, which the agent plan requires
    to be visible.

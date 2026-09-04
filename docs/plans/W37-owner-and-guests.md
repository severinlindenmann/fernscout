# W37 — One owner, per-trip travellers, and a guest list you can edit

## Why

`content/<user>/config.json` answers "who is this journal?" twice and gets it
wrong both times.

`travellers: [...]` is a **journal-wide list of everyone who has ever
travelled**, used only for display. It is the source of the "Alex + Robin"
string on the costs disclaimer, the structured-data author and the photobook
byline — which means every trip in the journal claims the same two people took
it. A solo trip is credited to two people. That is a small lie the site tells
on every page.

`ownerEmail` is the real identity: the one address that can obtain a write
token (`lib/access.ts`, decision 24). It sits beside `travellers` with no
relationship to it, so the person who owns the journal may or may not be in the
list of people it credits.

Meanwhile `people:` in `trip.md` — built in W26 — already records who was
actually on a given trip, with an email each, and already drives write access.
No trip in `content/example/` uses it, which is why the journal-wide list still
looks necessary.

This package makes the config name **one owner**, makes `people:` the single
answer to "who was on this trip" for display as well as access, and closes the
gap that made the guest list feel missing: there is currently no way for an
owner to add a guest at all.

## The model

### One owner, not a list

```json
{
  "owner": { "name": "Alex Berger", "nickname": "Alex", "email": "alex@example.com" }
}
```

Replaces both `travellers[]` and `ownerEmail`.

- `email` stays **optional**. A journal that declares no owner address cannot
  issue a write token to anybody, and so is read-only to the world. That is
  today's behaviour when `ownerEmail` is absent and it is worth keeping: it is
  the safe state, and it is what a freshly cloned repo is in.
- `nickname` stays. It is what the short display form is built from.

> **Decision.** An old config is a **loud error**, not a silent fallback.
> `parseUser` collects a problem naming exactly what to rewrite. The user
> config has no `configVersion` gate — only `content/config.json` has one — so
> a compatibility shim would mean two readable shapes forever and nobody ever
> migrating. `docs/config-upgrades.md` carries the before and after.

### Who took *this* trip

`people:` in `trip.md` is unchanged except that an entry may now carry an
optional nickname:

```yaml
people:
  - { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" }
```

Absent, `nickname` falls back to `name`. There is no derivation from the full
name: splitting on a space to guess a first name is how you mangle somebody's
name in the byline of their own holiday.

Display is built owner-first, then `people:`, de-duplicated on email — the same
union `peopleOf()` already computes for write access. One list answers both
questions, so the credit on a trip and the right to edit it can never disagree.

> **Decision.** No per-trip `people.json`. Trip metadata lives in `trip.md`,
> the parser and its ten-person cap are already written and tested, and a
> second file would be a second thing to keep in agreement with the first.

### Guests stay in the database

Guests are the `contacts` table, not config. A guest list is fifty named
people's home addresses; `content/` is a folder people commit to git, and
`lib/contacts/crypto.ts` exists precisely so that list is never stored in a
form the database — let alone a repository — can read.

Two changes:

**`tel` joins the encrypted blob.** `003-contacts.ts` argues that the postal
address is one opaque `postal_cipher` rather than a column per field. A phone
number is the same class of data, so it goes inside the same blob rather than
beside it. No new column, no migration, and the number is never in the clear.
`isPostable()` keeps testing only the postal fields, so a guest with a phone and
no address does not become postable.

**The owner can add and edit a guest.** Today a contact only exists after the
person fills in the join form themselves; there is no owner-side create at all.
`create` and `update` actions join `/api/contacts/admin` behind the existing
`isOwner` guard, with a form in `components/ContactsAdmin.tsx` reusing the field
set from `ContactForm.tsx`.

> **Decision.** An owner-created contact lands `pending`, never `active`.
> `approveContact` refuses to approve an unconfirmed address on purpose — an
> owner talked into approving an address nobody has proved they can read is how
> a `guest` trip leaks. A create action that minted `active` rows would walk
> around that guard. This costs nothing for postcards: only the digest filters
> on `status === "active"` (`lib/digest/index.ts:159`), so an address typed in
> by hand can be posted to immediately.

> **Decision.** No MCP tool for contacts. The MCP surface is content-shaped —
> `create_day`, `add_media` — and a `create_contact` would be the first thing on
> it that is not content. Dictating a postal address to an agent is also worse
> than typing it into a field, and the address is the one thing that has to be
> exactly right for a postcard to arrive.

## Work

1. **`lib/config.ts`** — `Traveller` → `Owner = { name, nickname, email? }`;
   `UserConfig.travellers` and `.ownerEmail` → `.owner`. `parseUser` validates
   it as one object, keeps the existing email regex, and reports the old shape
   as a migration problem.
2. **`lib/trips.ts`** — `parsePeople` reads an optional `nickname`, still
   failing closed on any malformed entry. `TripPerson` in `lib/types.ts` gains
   `nickname?`.
3. **`lib/site.ts`** — `travellerNamesOf(user, trip)` (nicknames joined with
   `+`, for the site's own voice) and `travellerFullNamesOf(user, trip)` (full
   names joined with `&`, for credits and metadata) take a trip and build the
   owner-first union. `SiteSummary.travellerNames` is **removed**: it has two
   consumers and both have a trip in hand.
4. **`lib/tripPeople.ts`** — `peopleOf` reads `user.owner.email`.
5. **Consumers** — `components/StructuredData.tsx` takes the author as a prop
   (all four call sites already have a trip); both costs pages pass the
   per-trip string; `lib/photobook/source.ts` and `scripts/photobook.ts` use
   the same helper. `lib/api/documentation.ts` is genuinely journal-wide and
   becomes the owner's name alone.
6. **`cost.disclaimer`** in `content/locales/{en,de,hu}.json` loses its
   hardcoded "For two people unless noted." It is already wrong for a solo
   trip, and this package is what makes it visibly wrong.
7. **`lib/contacts/crypto.ts`** — `tel` in the encrypted payload;
   `isPostable()` unchanged in meaning.
8. **`lib/contacts/index.ts`** — `createContactByOwner`, `updateContactByOwner`,
   both stamping `created_via: "owner"`.
9. **`app/api/contacts/admin/route.ts`** — `create` and `update` actions.
10. **`components/ContactsAdmin.tsx`** — the add/edit form.
11. **Migration** — `content/example/config.json`, the test fixtures carrying
    `travellers:`, `scripts/migrate-users.ts`, the content-model table in
    `AGENTS.md`, and a `docs/config-upgrades.md` entry for both breaking
    changes.

## Acceptance

- `parseUser` accepts `owner` and reports the old `travellers`/`ownerEmail`
  shape with a message naming what to rewrite.
- A journal whose `owner` has no `email` can still be read and cannot issue a
  write token.
- A solo trip is credited to the owner alone; a two-person trip names both; an
  owner also listed in `people:` is named once.
- `parsePeople` reads a nickname, falls back to `name` without one, and still
  drops the whole list on a malformed entry.
- A `tel` survives the encrypt/decrypt round trip. A contact with a tel and no
  address is not `isPostable`.
- `create` mints a `pending` contact and cannot mint an `active` one; `update`
  leaves `status` untouched.
- The four gates pass, and the dev server boots with `contacts` on and off.

## Stop line

No guest data in `config.json`. No per-trip `people.json`. No MCP tool for
contacts. No changes to the invite flow — a forwarded invite link staying
harmless is decision 19 and this package does not touch it.

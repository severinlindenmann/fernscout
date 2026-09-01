# W37 — One Owner, Per-Trip Travellers, Editable Guests: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the journal-wide `travellers[]` list and its detached `ownerEmail` with a single `owner`, make each trip's `people:` block the source of both its byline and its write access, and give the owner a way to add a guest with a phone number.

**Architecture:** Four independent seams, done in order because the first breaks the type that the rest read. `lib/config.ts` gains `owner` and loses `travellers`/`ownerEmail`; `lib/site.ts` turns two journal-wide display helpers into per-trip ones built from the same owner-first union `lib/tripPeople.ts` already computes for access; `lib/contacts/crypto.ts` gains a `tel` field inside the blob it already encrypts; and `/api/contacts/admin` gains `create`/`update` over the existing `requestContact` upsert.

**Tech Stack:** Next.js (see `AGENTS.md` — read `node_modules/next/dist/docs/` before touching framework APIs), TypeScript, Vitest, Kysely over SQLite (dev) and Postgres (prod).

**Spec:** `docs/plans/W37-owner-and-guests.md`

## Global Constraints

- **Verify with all four gates, every task:** `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`. A task is not done until all four pass.
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if a real name or trip id appears outside `content/`. Test fixtures use `A B` / `alex@example.com` style placeholders.
- **Secrets never enter `content/config.json`** — environment only.
- **`MAX_TRIP_PEOPLE` is 10** and stays enforced at parse time.
- **`parsePeople` fails closed**: any malformed entry drops the whole list, never one line.
- **The owner's `email` is optional.** A journal with no owner address must stay readable and must issue no write token.
- **An owner-created contact is `pending`.** No code path in this plan may produce an `active` contact.
- Commit after each task with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

---

## File Structure

**Task 1 — the config type**
- Modify: `lib/config.ts` (`Owner` type, `parseUser`)
- Modify: `lib/tripPeople.ts:19`, `lib/contacts/session.ts:29-39`, `lib/contacts/mail.ts:115-119`, `lib/photobook/source.ts:19,108-110`, `lib/site.ts:29-37`, `lib/api/documentation.ts:104`, `app/api/auth/request/route.ts:133-138`, `app/api/auth/verify/route.ts:105`
- Modify: `content/example/config.json`, `scripts/migrate-users.ts:56`, `test/depersonalised.test.ts:85`, `AGENTS.md`, `docs/config-upgrades.md`
- Modify: every fixture carrying `travellers:` (list in Task 1, Step 6)
- Test: `test/config.test.ts`

**Task 2 — a nickname on a trip person**
- Modify: `lib/types.ts:192-196`, `lib/trips.ts:71-116`
- Test: `test/trips.test.ts`

**Task 3 — the byline becomes per-trip**
- Modify: `lib/site.ts:30-37,47,74`, `components/StructuredData.tsx`, its four call sites, both costs pages, `lib/photobook/source.ts:108`, `scripts/photobook.ts:171`, `lib/api/documentation.ts:104`
- Modify: `docs/config-upgrades.md`
- Test: `test/site-travellers.test.ts` (create)

**Task 4 — the disclaimer stops claiming two people**
- Modify: `content/locales/{en,de,hu}.json:123`

**Task 5 — `tel` inside the encrypted blob**
- Modify: `lib/contacts/crypto.ts:26-42,105-121`
- Test: `test/contacts.test.ts`

**Task 6 — the owner adds a guest**
- Modify: `lib/contacts/index.ts` (`updateContactByOwner`), `app/api/contacts/admin/route.ts:84-121`, `components/ContactsAdmin.tsx`
- Test: `test/contacts.test.ts`

---

### Task 1: One `owner` in the user config

Replaces `travellers[]` and `ownerEmail` with one object. This breaks the type
six modules read, so the whole rename lands in one commit — a half-renamed
`UserConfig` does not compile, and there is no useful review gate in the middle
of it.

**Files:**
- Modify: `lib/config.ts`
- Modify: `lib/tripPeople.ts`, `lib/contacts/session.ts`, `lib/contacts/mail.ts`, `lib/photobook/source.ts`, `lib/site.ts`, `lib/api/documentation.ts`, `app/api/auth/request/route.ts`, `app/api/auth/verify/route.ts`
- Modify: `content/example/config.json`, `scripts/migrate-users.ts`, `test/depersonalised.test.ts`, `AGENTS.md`, `docs/config-upgrades.md`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Owner = { name: string; nickname: string; email?: string };
  // on UserConfig: `owner: Owner`  — replaces `travellers: Traveller[]` and `ownerEmail?: string`
  ```
  `Traveller` and `UserConfig.ownerEmail` no longer exist. Tasks 3 and 6 read `user.owner`.

- [ ] **Step 1: Write the failing tests**

In `test/config.test.ts`, change the `VALID` fixture's `travellers` line to
`owner: { name: "A B", nickname: "A", email: "a@example.com" }`, then add:

```ts
describe("owner", () => {
  test("reads name, nickname and email", () => {
    const cfg = parseUserConfig("u", clone());
    expect(cfg.owner).toEqual({ name: "A B", nickname: "A", email: "a@example.com" });
  });

  test("lower-cases and trims the address, as an address is compared", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A", email: "  A@Example.COM " };
    expect(parseUserConfig("u", raw).owner.email).toBe("a@example.com");
  });

  test("an owner with no email parses — that journal is read-only", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A" };
    expect(parseUserConfig("u", raw).owner.email).toBeUndefined();
  });

  test("rejects an owner that is not an object", () => {
    const raw = clone();
    raw.owner = "A B";
    expect(problemsOf(raw)).toContain("owner must be { name, nickname, email? }");
  });

  test("rejects a malformed address rather than dropping it", () => {
    const raw = clone();
    raw.owner = { name: "A B", nickname: "A", email: "not-an-address" };
    expect(problemsOf(raw)).toContain("owner.email must be an email address, or absent");
  });

  test("names the migration when the old shape is still there", () => {
    const raw = clone();
    delete raw.owner;
    raw.travellers = [{ name: "A B", nickname: "A" }];
    raw.ownerEmail = "a@example.com";
    const problems = problemsOf(raw);
    expect(problems.some((p) => p.includes("travellers"))).toBe(true);
    expect(problems.some((p) => p.includes("owner"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `cfg.owner` is `undefined`, and the old-shape test parses cleanly.

- [ ] **Step 3: Change the type in `lib/config.ts`**

Replace `export type Traveller = { name: string; nickname: string };` with:

```ts
/**
 * Whose journal this is.
 *
 * One person, not a list. The list this replaces was journal-wide and
 * display-only, which meant every trip in a journal was credited to the same
 * people whether or not they were on it; who was actually on a trip is that
 * trip's `people:` block, and `lib/site.ts` builds the byline from both.
 *
 * `email` is optional and absent means read-only: it is the only address that
 * can obtain a write token for the journal (decision 24), so a journal that
 * declares no owner cannot be written to by anyone. That is the safe state,
 * and the state a freshly cloned repository is in.
 */
export type Owner = { name: string; nickname: string; email?: string };
```

On `UserConfig`, delete the `ownerEmail?: string;` field and its doc comment,
delete `travellers: Traveller[];`, and add `owner: Owner;` in its place.

- [ ] **Step 4: Change the parser in `lib/config.ts`**

Delete the `travellers` block (the `const travellers: Traveller[] = []` loop)
and the `ownerEmailRaw` block. In their place:

```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseOwner(src: Record<string, unknown>, problems: string[]): Owner {
  // The shape before W37. Named explicitly rather than ignored: this file has
  // no configVersion gate, so an unrecognised key would otherwise be a journal
  // that silently loses its owner and becomes read-only.
  if (src.owner === undefined && (src.travellers !== undefined || src.ownerEmail !== undefined)) {
    problems.push(
      'travellers and ownerEmail were replaced by a single owner: ' +
        '"owner": { "name": …, "nickname": …, "email": … }. ' +
        "Who was on a given trip now belongs in that trip's people: block. " +
        "See docs/config-upgrades.md.",
    );
    return { name: "", nickname: "" };
  }

  const raw = src.owner;
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.nickname !== "string") {
    problems.push("owner must be { name, nickname, email? }");
    return { name: "", nickname: "" };
  }

  const owner: Owner = { name: raw.name, nickname: raw.nickname };
  if (raw.email !== undefined) {
    if (typeof raw.email !== "string" || !EMAIL_RE.test(raw.email.trim())) {
      problems.push("owner.email must be an email address, or absent");
    } else {
      owner.email = raw.email.trim().toLowerCase();
    }
  }
  return owner;
}
```

Call it in `parseUser` and put `owner: parseOwner(src, problems),` into the
returned object, dropping the `travellers` and `ownerEmail` keys.

- [ ] **Step 5: Point the six consumers at `user.owner.email`**

Each is a one-line change; the address is already lower-cased at parse time, so
the `?.trim().toLowerCase()` calls come off.

- `lib/tripPeople.ts:19` → `const owner = getUser(trip.username)?.owner.email;`
- `lib/contacts/session.ts:29-30` → `if (!user?.owner.email) return false;` and `const ownerEmail = user.owner.email;`
- `lib/contacts/mail.ts:115-119` → `if (!user.owner.email) return null;` and pass `user.owner.email`
- `app/api/auth/request/route.ts:133` → the parameter type becomes `{ username: string; owner: { email?: string } }`; line 138 → `if (user.owner.email === address) return true;`
- `app/api/auth/verify/route.ts:105` → `const owner = getUser(username)?.owner.email;`
- `lib/viewer.ts:16` — comment only, say `owner.email`
Three more files read `user.travellers` and so stop compiling the moment the
field goes. Each gets the smallest stopgap that keeps its current signature and
today's behaviour for a journal with one traveller; Task 3 replaces all three
with the per-trip helpers, which cannot exist yet.

- `lib/photobook/source.ts:19,108-110` — the only importer of the `Traveller`
  type. Drop `type Traveller` from the import and preserve today's
  nickname-first choice:

  ```ts
  const travellers = [config.owner.nickname || config.owner.name].filter(Boolean);
  ```

- `lib/site.ts:29-37` — keep both helpers' one-argument signatures, so
  `siteSummaryFor` and every caller are untouched:

  ```ts
  /** Temporary: one owner, until Task 3 makes this per-trip. */
  export function travellerNamesOf(user: UserConfig): string {
    return user.owner.nickname;
  }

  export function travellerFullNamesOf(user: UserConfig): string {
    return user.owner.name;
  }
  ```

- `lib/api/documentation.ts:104` — `user.owner.name`. This one is journal-wide
  and Task 3 leaves it that way, so it is the final form, not a stopgap.

- [ ] **Step 6: Rewrite every config that still has the old shape**

`content/example/config.json` — replace the `ownerEmail` and `travellers` keys with:

```json
  "owner": { "name": "Alex Berger", "nickname": "Alex", "email": "agent@fernscout.ch" },
```

Then these fixtures and inline configs, each `travellers: [{ name: "A B", nickname: "A" }]`
→ `owner: { name: "A B", nickname: "A" }` (keep any `ownerEmail` value as the
new `email`, and drop the separate key):

`test/fixtures/visibility/u/config.json`, `test/fixtures/currency/u/config.json`,
`test/fixtures/content/u/config.json`, `test/fixtures/feed/creator/config.json`,
`test/push-route.test.ts:40`, `test/contacts.test.ts:531`, `test/mcp.test.ts:138`,
`test/media-upload.test.ts:66`, `test/multiuser.test.ts:28`,
`test/trip-people.test.ts:58-59`, `test/entry-cache.test.ts:39`,
`test/plan.test.ts:59`, `test/export.test.ts:38`, `test/landing.test.tsx:72`,
`test/digest.test.ts:86`, `test/agent-interface.test.ts:51`,
`test/locales.test.ts:37`, `test/draft-visibility.test.ts:59`,
`test/trips.test.ts:8`, `test/photobook.test.ts:87`.

`test/multiuser.test.ts:117` asserts the server config has no `travellers`
property; change it to `owner`.

`test/depersonalised.test.ts:85-90` — replace the `user.travellers` loop with:

```ts
    const owner = user.owner as { name?: unknown; nickname?: unknown } | undefined;
    add(owner?.name);
    add(owner?.nickname);
```

`scripts/migrate-users.ts:56` — replace `travellers: site.travellers ?? [],` with:

```ts
    owner: {
      name: site.travellers?.[0]?.name ?? username,
      nickname: site.travellers?.[0]?.nickname ?? username,
      ...(site.ownerEmail ? { email: site.ownerEmail } : {}),
    },
```

- [ ] **Step 7: Document the break**

Add to `docs/config-upgrades.md`, matching the file's existing section style:

```markdown
## W37 — `travellers` and `ownerEmail` become `owner`

A user's `content/<username>/config.json` named its people twice. `travellers`
was a journal-wide display list, so every trip in a journal was credited to the
same people whether or not they were on it; `ownerEmail` beside it was the real
identity, with no relationship to the list.

Before:

    "ownerEmail": "alex@example.com",
    "travellers": [
      { "name": "Alex Berger", "nickname": "Alex" },
      { "name": "Robin Berger", "nickname": "Robin" }
    ],

After:

    "owner": { "name": "Alex Berger", "nickname": "Alex", "email": "alex@example.com" },

Everyone else who was on a trip belongs in that trip's `people:` block in
`trip.md`, which already decides who may write to it and now also decides who
the trip is credited to:

    people:
      - { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" }

`owner.email` stays optional; a journal without one is read-only, as it was
without `ownerEmail`.
```

- [ ] **Step 8: Update the content model in `AGENTS.md`**

In the `content/` tree block, change the `<username>/config.json` line from
"who this person is: title, tagline, travellers, locales, baseCurrency,
per-user features" to "…title, tagline, owner, locales, baseCurrency, per-user
features". In "The shape of an entry and a trip", extend the `people:` paragraph
to say the block is what the trip is credited to as well as who may write to it.

- [ ] **Step 9: Run the four gates**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
W37: one owner in the user config, not a list beside an address

travellers[] was journal-wide and display-only, so every trip in a journal
was credited to the same people whether or not they were on it. ownerEmail
sat beside it as the real identity with no relationship to the list.

One `owner` now, with the address on it. An old config is a named problem
rather than a silent fallback: this file has no configVersion gate, so a
shim would mean two readable shapes forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: A trip person may carry a nickname

**Files:**
- Modify: `lib/types.ts`, `lib/trips.ts`
- Test: `test/trip-people.test.ts`

`test/trips.test.ts` reads fixed fixtures off disk and has no helper for writing
a `people:` block; `test/trip-people.test.ts` builds a temp content dir and
already has `writeTrip(id, people: string[])`. The nickname tests go there,
beside the rest of the `people:` parsing tests.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `TripPerson = { name: string; email: string; nickname?: string }`. Task 3 reads `person.nickname ?? person.name`.

- [ ] **Step 1: Write the failing tests**

Add to `test/trip-people.test.ts`, using its existing `writeTrip` helper and
`trip` accessor:

```ts
describe("a nickname on a person", () => {
  test("is read when given", () => {
    writeTrip("nick-1", [
      '  - { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" }',
    ]);
    expect(trip("nick-1").people[0].nickname).toBe("Robin");
  });

  test("is absent rather than guessed from the name", () => {
    writeTrip("nick-2", ['  - { name: "Robin Berger", email: "robin@example.com" }']);
    expect(trip("nick-2").people[0].nickname).toBeUndefined();
  });

  test("drops the whole list when it is not text, as any bad entry does", () => {
    writeTrip("nick-3", [
      '  - { name: "Robin Berger", email: "robin@example.com", nickname: 7 }',
    ]);
    expect(trip("nick-3").people).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/trip-people.test.ts`
Expected: FAIL — `nickname` is not a property of `TripPerson`, so this will not
even type-check.

- [ ] **Step 3: Add the field to `lib/types.ts`**

In `TripPerson`, after `email`:

```ts
  /**
   * What to call them in a byline. Optional, falling back to `name`.
   *
   * There is no derivation from the full name: splitting on a space to guess a
   * first name is how you mangle somebody's name in the credit line of their
   * own holiday.
   */
  nickname?: string;
```

- [ ] **Step 4: Read it in `parsePeople`**

In `lib/trips.ts`, inside the loop, after the duplicate-email check and before
`people.push`:

```ts
    const rawNickname = entry.nickname;
    if (rawNickname !== undefined && typeof rawNickname !== "string") {
      console.warn(
        `[trips] ${folder}/trip.md has a people: entry whose nickname is not text — ` +
          `ignoring the whole list.`,
      );
      return [];
    }
    const nickname = rawNickname?.trim() || undefined;
```

and change the push to `people.push({ name, email, ...(nickname ? { nickname } : {}) });`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/trip-people.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the four gates and commit**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
git add lib/types.ts lib/trips.ts test/trip-people.test.ts
git commit -m "$(cat <<'MSG'
W37: a person on a trip may say what to call them

The byline needs a short form, and the only honest source of one is the
person themselves. Optional, falling back to the full name — splitting on a
space to guess a first name mangles names for a living.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The byline is built per trip

**Files:**
- Modify: `lib/site.ts`, `components/StructuredData.tsx`, `app/[user]/trips/[trip]/page.tsx`, `app/[user]/trips/[trip]/day/[slug]/page.tsx`, `app/[user]/(trip)/page.tsx`, `app/[user]/(trip)/day/[slug]/page.tsx`, `app/[user]/(trip)/costs/CostsPageContent.tsx`, `app/[user]/(trip)/costs/page.tsx`, `app/[user]/trips/[trip]/costs/page.tsx`, `lib/photobook/source.ts`, `scripts/photobook.ts`, `lib/api/documentation.ts`, `docs/config-upgrades.md`
- Test: `test/site-travellers.test.ts` (create)

**Interfaces:**
- Consumes: `Owner` (Task 1), `TripPerson.nickname` (Task 2).
- Produces:
  ```ts
  export function travellersOf(user: UserConfig, trip: Trip): TripPerson[];
  export function travellerNamesOf(user: UserConfig, trip: Trip): string;      // "Alex + Robin"
  export function travellerFullNamesOf(user: UserConfig, trip: Trip): string;  // "Alex Berger & Robin Berger"
  ```
  `SiteSummary.travellerNames` no longer exists. `BlogStructuredData` and `DayStructuredData` take a new required `authors: string` prop. `CostsPageContent` takes a new required `travellers: string` prop.

- [ ] **Step 1: Write the failing tests**

Create `test/site-travellers.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { travellerFullNamesOf, travellerNamesOf, travellersOf } from "@/lib/site";
import type { Trip } from "@/lib/types";
import type { UserConfig } from "@/lib/config";

const user = {
  owner: { name: "Alex Berger", nickname: "Alex", email: "alex@example.com" },
} as UserConfig;

const tripWith = (people: Trip["people"]) => ({ people }) as Trip;

describe("who a trip is credited to", () => {
  test("a solo trip is the owner alone", () => {
    expect(travellerNamesOf(user, tripWith([]))).toBe("Alex");
    expect(travellerFullNamesOf(user, tripWith([]))).toBe("Alex Berger");
  });

  test("a shared trip names both, owner first", () => {
    const trip = tripWith([
      { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
    ]);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin");
    expect(travellerFullNamesOf(user, trip)).toBe("Alex Berger & Robin Berger");
  });

  test("a person with no nickname is credited by name", () => {
    const trip = tripWith([{ name: "Robin Berger", email: "robin@example.com" }]);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin Berger");
  });

  test("an owner also listed in people: is named once", () => {
    const trip = tripWith([
      { name: "Alex Berger", email: "ALEX@example.com", nickname: "Alex" },
      { name: "Robin Berger", email: "robin@example.com", nickname: "Robin" },
    ]);
    expect(travellersOf(user, trip)).toHaveLength(2);
    expect(travellerNamesOf(user, trip)).toBe("Alex + Robin");
  });

  test("an owner with no address is still credited", () => {
    const anon = { owner: { name: "Alex Berger", nickname: "Alex" } } as UserConfig;
    expect(travellerNamesOf(anon, tripWith([]))).toBe("Alex");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/site-travellers.test.ts`
Expected: FAIL — `travellersOf` is not exported, and the existing helpers take
one argument.

- [ ] **Step 3: Rewrite the helpers in `lib/site.ts`**

Replace Task 1's one-argument stopgaps for `travellerNamesOf` and
`travellerFullNamesOf` with:

```ts
/**
 * Who a trip is credited to, owner first.
 *
 * The same owner-first union `peopleOf()` computes for write access, so the
 * credit on a trip and the right to edit it cannot disagree. De-duplicated on
 * the address, because an owner who also lists themselves in `people:` is one
 * person, not two.
 */
export function travellersOf(user: UserConfig, trip: Trip): TripPerson[] {
  const owner: TripPerson = {
    name: user.owner.name,
    email: user.owner.email ?? "",
    nickname: user.owner.nickname,
  };
  const out = [owner];
  const seen = new Set([owner.email]);
  for (const person of trip.people) {
    const email = person.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(person);
  }
  return out;
}

/** Short forms joined with "+", as a journal refers to the people on a trip. */
export function travellerNamesOf(user: UserConfig, trip: Trip): string {
  return travellersOf(user, trip)
    .map((p) => p.nickname ?? p.name)
    .join(" + ");
}

/** Full names joined with "&", for credits and metadata. */
export function travellerFullNamesOf(user: UserConfig, trip: Trip): string {
  return travellersOf(user, trip)
    .map((p) => p.name)
    .join(" & ");
}
```

Add `import type { Trip, TripPerson } from "./types";` at the top.

Note the de-duplication compares against an owner whose email may be `""`; a
`people:` entry always has a real address (`parsePeople` requires one), so an
empty owner address can never collide with one.

- [ ] **Step 4: Remove `travellerNames` from `SiteSummary`**

In `lib/site.ts`, delete the `travellerNames: string;` field from the
`SiteSummary` type and the `travellerNames: travellerNamesOf(user),` line from
`siteSummaryFor`. Add a line to the type's doc comment:

```ts
  /**
   * Deliberately no traveller names. Who was on a trip is a per-trip fact
   * (`travellersOf`), and this summary is seeded once per request by a layout
   * that has no trip in hand — a journal-wide answer here is how every trip
   * came to be credited to the same two people.
   */
```

- [ ] **Step 5: Give `StructuredData` the authors as a prop**

In `components/StructuredData.tsx`, add `authors: string` to both components'
props and replace both `name: site.travellerNames` with `name: authors`.

At the four call sites, pass it. Each already has the trip and the user:

- `app/[user]/trips/[trip]/page.tsx:83` and `app/[user]/(trip)/page.tsx:32` →
  `<BlogStructuredData entries={…} site={site} authors={travellerFullNamesOf(user, trip)} />`
- `app/[user]/trips/[trip]/day/[slug]/page.tsx:98` and `app/[user]/(trip)/day/[slug]/page.tsx:93` →
  `<DayStructuredData entry={entry} site={site} authors={travellerFullNamesOf(user, trip)} />`

Where a page has the trip id but not the `Trip`, fetch it with `getTrip()` from
`lib/trips.ts` alongside the existing lookups, and the user with `getUser()`
from `lib/users.ts`. Use `travellerFullNamesOf` — schema.org wants a person's
name, not a household nickname.

- [ ] **Step 6: Give the costs page its string**

In `app/[user]/(trip)/costs/CostsPageContent.tsx`, add `travellers: string` to
the component's props and change line 205 from `travellers: site.travellerNames`
to `travellers,`. Pass it from both costs pages
(`app/[user]/(trip)/costs/page.tsx` and `app/[user]/trips/[trip]/costs/page.tsx`)
as `travellerNamesOf(user, trip)` — the disclaimer is the site's own voice, so
nicknames.

- [ ] **Step 7: Point the photobook and the documentation at the new helpers**

- `lib/photobook/source.ts:108` — `trip` is already in scope (line 105).
  Replace the stopgap from Task 1 with:

  ```ts
  const travellers = travellersOf(config, trip)
    .map((p) => p.nickname ?? p.name)
    .filter(Boolean);
  ```

  Nickname first, deliberately: that is what the book prints today
  (`t.nickname || t.name`), and "Written and photographed by Alex and Robin"
  is the line `lib/photobook/plan.ts:701` was written for. Full names here
  would be a silent change to a printed page.
- `scripts/photobook.ts:171` — no change. It reads `source.travellers`, which
  stays a `string[]` on the photobook source; only how that array is built
  moves.
- `lib/api/documentation.ts:104` — already final after Task 1's stopgap pass
  (`user.owner.name`). No change; confirm and leave it.

- [ ] **Step 8: Note the second break in `docs/config-upgrades.md`**

Append to the W37 section written in Task 1:

```markdown
`SiteSummary` no longer carries `travellerNames`. A fork rendering its own
components should read `travellerNamesOf(user, trip)` from `lib/site.ts`, which
needs the trip because who was on one is a per-trip fact.
```

- [ ] **Step 9: Run the tests, then the four gates**

Run: `npx vitest run test/site-travellers.test.ts`
Expected: PASS.

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```
Expected: all pass. `test/site-nav.test.tsx:36` and `test/access-panel.test.tsx:43`
set `travellerNames` in a `SiteSummary` fixture; delete that line from both —
`tsc` will point at them.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
W37: credit a trip to the people who were on it

The costs disclaimer, the structured-data author and the photobook byline
all read one journal-wide string, so a solo trip was credited to two people.
They now read the owner-first union of the owner and the trip's people: —
the same union peopleOf() already computes for write access, so the credit
and the right to edit cannot disagree.

SiteSummary loses travellerNames: it is seeded by a layout with no trip in
hand, which is how the journal-wide answer got there in the first place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: The disclaimer stops claiming two people

**Files:**
- Modify: `content/locales/en.json`, `content/locales/de.json`, `content/locales/hu.json`

- [ ] **Step 1: Drop the hardcoded clause**

`cost.disclaimer` ends with a sentence asserting a party of two. With Task 3 the
`{travellers}` placeholder already says who was there, so the clause is both
redundant and wrong for a solo trip. Remove the final sentence from each,
keeping the rest verbatim:

- `en.json:123` — drop `" For two people unless noted."`
- `de.json:123` — drop `" Für zwei Personen, sofern nicht anders vermerkt."`
- `hu.json:123` — drop `" Két főre, hacsak nincs másképp jelölve."`

Leave `{travellers}` and `{currency}` untouched.

- [ ] **Step 2: Run the four gates and commit**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
git add content/locales
git commit -m "$(cat <<'MSG'
W37: the cost disclaimer stops asserting a party of two

It was hardcoded in all three locales and already wrong for a solo trip.
{travellers} now names whoever was actually there, so the clause was
redundant as well as untrue.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: A phone number, inside the blob that is already encrypted

**Files:**
- Modify: `lib/contacts/crypto.ts`
- Test: `test/contacts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PostalAddress` gains `tel: string`. `EMPTY_ADDRESS.tel === ""`. `isPostable` is unchanged in meaning: it still tests only `line1`, `city`, `country`.

- [ ] **Step 1: Write the failing tests**

Add to `test/contacts.test.ts` (follow the file's existing pattern for setting
`CONTACTS_ENCRYPTION_KEY`):

```ts
describe("a telephone number", () => {
  test("survives the round trip", () => {
    const aad = addressAad("u", "c1");
    const address = { ...EMPTY_ADDRESS, tel: "+41 79 000 00 00", line1: "1 Road", city: "Bern", country: "CH" };
    expect(decryptAddress(encryptAddress(address, aad), aad)?.tel).toBe("+41 79 000 00 00");
  });

  test("a tel alone does not make somebody postable", () => {
    expect(isPostable({ ...EMPTY_ADDRESS, tel: "+41 79 000 00 00" })).toBe(false);
  });

  test("a blob written before this field decrypts with an empty tel", () => {
    const aad = addressAad("u", "c2");
    // Encrypt a payload with no tel key at all, as existing rows hold.
    const legacy = encryptAddress(
      { name: "", line1: "1 Road", line2: "", postcode: "", city: "Bern", country: "CH" } as never,
      aad,
    );
    expect(decryptAddress(legacy, aad)?.tel).toBe("");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/contacts.test.ts`
Expected: FAIL — `tel` is not a property of `PostalAddress`.

- [ ] **Step 3: Add the field**

In `lib/contacts/crypto.ts`, add to `PostalAddress`:

```ts
  /**
   * A telephone number, if they gave one.
   *
   * In here rather than in a column of its own, for the reason
   * `003-contacts.ts` gives about the address: this is the same class of data,
   * and a plaintext column beside an encrypted blob is a way of leaking half of
   * what the blob exists to protect. It is not part of `isPostable` — a number
   * is not somewhere to send a card.
   */
  tel: string;
```

Add `tel: "",` to `EMPTY_ADDRESS`, and `tel: field(input?.tel),` to
`normaliseAddress`. Because `decryptAddress` already passes its parsed JSON
through `normaliseAddress`, a row written before this field decrypts to `tel: ""`
with no migration.

Update the module's header comment: the blob is the private details, of which
the postal address is most of it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/contacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the four gates and commit**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
git add lib/contacts/crypto.ts test/contacts.test.ts
git commit -m "$(cat <<'MSG'
W37: a phone number, inside the blob that is already encrypted

003-contacts argues the postal address is one opaque ciphertext rather than
a column per field. A telephone number is the same class of data, so it goes
inside the same blob rather than beside it in the clear — no new column, no
migration, and normaliseAddress gives existing rows an empty tel for free.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The owner adds and edits a guest

**Files:**
- Modify: `lib/contacts/index.ts`, `app/api/contacts/admin/route.ts`, `components/ContactsAdmin.tsx`
- Test: `test/contacts.test.ts`

**Interfaces:**
- Consumes: `PostalAddress.tel` (Task 5), the existing `requestContact(owner, input: ContactRequestInput)`.
- Produces:
  ```ts
  export async function updateContactByOwner(
    owner: string,
    id: string,
    fields: {
      name?: string;
      email?: string;
      locale?: Locale;
      address?: Partial<PostalAddress> | null;
      wantsEmailDigest?: boolean;
      wantsPostcard?: boolean;
    },
  ): Promise<ContactRecord | null>;
  ```
  Two new `action` values on `POST /api/contacts/admin`: `create` and `update`.

**Note on reuse:** the spec sketched a `createContactByOwner`. There is no need
for one — `requestContact` is already a create-or-update keyed on email, already
lands the row `pending`, and already accepts `createdVia: "owner"`, a value
`003-contacts.ts` anticipated. `create` is a thin call to it. Only `update`
needs new store code, because it is keyed on **id** so that the owner can
correct an address that was typed wrong.

- [ ] **Step 1: Write the failing tests**

Add to `test/contacts.test.ts`, using the file's existing database setup:

```ts
describe("the owner adding a guest", () => {
  test("creates a pending contact, marked as the owner's doing", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH", tel: "+41 79 000 00 00" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const contact = await getContact("u", contactId!);
    expect(contact?.status).toBe("pending");
    expect(contact?.createdVia).toBe("owner");
    expect(contact?.postalAddress?.tel).toBe("+41 79 000 00 00");
  });

  test("a pending contact can still be posted to", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran2@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const contact = await getContact("u", contactId!);
    expect(contact?.status).toBe("pending");
    expect(contact?.wantsPostcard).toBe(true);
    expect(contact?.hasPostalAddress).toBe(true);
  });

  test("update corrects the address and leaves the status alone", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran3@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const before = await getContact("u", contactId!);
    const after = await updateContactByOwner("u", contactId!, {
      address: { line1: "2 Road", city: "Bern", country: "CH" },
    });
    expect(after?.postalAddress?.line1).toBe("2 Road");
    expect(after?.status).toBe(before?.status);
  });

  test("update returns null for a contact in another journal", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran4@example.com", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    expect(await updateContactByOwner("other", contactId!, { name: "X" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/contacts.test.ts`
Expected: FAIL — `updateContactByOwner` is not exported.

- [ ] **Step 3: Write `updateContactByOwner`**

In `lib/contacts/index.ts`, after `revokeContact`:

```ts
/**
 * The owner correcting somebody's details.
 *
 * Keyed on **id**, not on the address, because the commonest correction is the
 * address itself — `requestContact` would write a second row for the new one
 * and leave the old behind.
 *
 * Deliberately cannot touch `status`. Approving is `approveContact`, and it
 * refuses an unconfirmed address on purpose; a general-purpose editor that
 * could set `status` would be a way around that refusal.
 */
export async function updateContactByOwner(
  owner: string,
  id: string,
  fields: {
    name?: string;
    email?: string;
    locale?: Locale;
    address?: Partial<PostalAddress> | null;
    wantsEmailDigest?: boolean;
    wantsPostcard?: boolean;
  },
): Promise<ContactRecord | null> {
  const { db } = await getDatabase();
  const existing = await db
    .selectFrom("contacts")
    .selectAll()
    .where("owner_id", "=", owner)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!existing) return null;

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (fields.name !== undefined) patch.name = fields.name.trim().slice(0, 120) || null;
  if (fields.email !== undefined) {
    const email = normaliseEmail(fields.email);
    patch.email = email;
    patch.email_key = email;
  }
  if (fields.locale !== undefined) patch.locale = fields.locale;
  if (fields.wantsEmailDigest !== undefined) {
    patch.wants_email_digest = fields.wantsEmailDigest ? 1 : 0;
  }
  if (fields.address !== undefined) {
    const address = normaliseAddress(fields.address);
    patch.postal_cipher = isPostable(address)
      ? encryptAddress(address, addressAad(owner, id))
      : null;
    // Wanting a postcard with nowhere to send it is not a state worth storing.
    if (!isPostable(address)) patch.wants_postcard = 0;
  }
  if (fields.wantsPostcard !== undefined && patch.wants_postcard === undefined) {
    patch.wants_postcard = fields.wantsPostcard ? 1 : 0;
  }

  await db.updateTable("contacts").set(patch).where("id", "=", id).execute();
  return getContact(owner, id);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/contacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two actions to the admin route**

In `app/api/contacts/admin/route.ts`, add these imports: `requestContact`,
`getContact` and `updateContactByOwner` from `@/lib/contacts`; `isEmail` and
`issueCode` from `@/lib/auth`; `normaliseAddress` and `isPostable` (and the
`PostalAddress` type) from `@/lib/contacts/crypto`; `pickLocale` from
`@/lib/contacts/locale`; `sendCodeMail` from `@/lib/contacts/mail`.

The three signatures this uses, copied from the working example in
`app/api/contacts/request/route.ts:88-107` — get them right the first time, they
are all easy to guess wrong:

```ts
pickLocale(bodyLocale: string | null, inviteLocale: Locale | null | undefined, fallback: string): Locale
issueCode(owner: string, email: string, kind: SessionKind): Promise<IssuedCode>  // → { code }
sendCodeMail(username: string, user: UserConfig, to: string, locale: Locale, code: string)
```

Add before `default:`:

```ts
    case "create": {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email : "";
      if (name === "") return Response.json({ error: "invalid_name" }, { status: 400 });
      if (!isEmail(email)) return Response.json({ error: "invalid_email" }, { status: 400 });

      const address = normaliseAddress(
        typeof body.address === "object" && body.address !== null
          ? (body.address as Record<string, unknown>)
          : null,
      );
      const wantsPostcard = body.wantsPostcard === true;
      if (wantsPostcard && !isPostable(address)) {
        return Response.json({ error: "invalid_address" }, { status: 400 });
      }

      const user = getUser(username)!;
      const locale = pickLocale(
        typeof body.locale === "string" ? body.locale : null,
        null,
        user.defaultLocale,
      );

      // `pending`, like every other route into this table. The owner typing an
      // address is not the address proving it can be read, and approveContact
      // refuses an unconfirmed one for a reason.
      //
      // The address is passed whether or not a postcard was asked for, unlike
      // the public form, which passes it only with the tick. This is the
      // owner's own address book: a number and a street they typed in is
      // something they meant to keep, not a consent they granted themselves.
      const result = await requestContact(username, {
        name,
        email,
        locale,
        address,
        wantsEmailDigest: body.wantsEmailDigest === true,
        wantsPostcard,
        createdVia: "owner",
      });
      if (result.outcome === "ignored") {
        return Response.json({ error: "blocked_contact" }, { status: 409 });
      }
      // The same six-digit code the public form sends. Without it the row can
      // never be confirmed and so can never be approved, and an owner-created
      // contact would be a dead end.
      const { code } = await issueCode(username, email, "guest");
      await sendCodeMail(username, user, email, locale, code);

      const contact = await getContact(username, result.contactId);
      return Response.json({ ok: true, contact: contact ? ownerView(contact) : null });
    }
    case "update": {
      const contact = await updateContactByOwner(username, id, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.locale === "string"
          ? { locale: pickLocale(body.locale, null, getUser(username)!.defaultLocale) }
          : {}),
        ...(body.address !== undefined
          ? { address: body.address as Partial<PostalAddress> | null }
          : {}),
        ...(typeof body.wantsEmailDigest === "boolean"
          ? { wantsEmailDigest: body.wantsEmailDigest }
          : {}),
        ...(typeof body.wantsPostcard === "boolean"
          ? { wantsPostcard: body.wantsPostcard }
          : {}),
      });
      if (!contact) return Response.json({ error: "unknown_contact" }, { status: 404 });
      return Response.json({ ok: true, contact: ownerView(contact) });
    }
```

Check `issueCode` and `sendCodeMail`'s exact signatures against
`app/api/contacts/request/route.ts` and match them — that route is the working
example of this sequence.

Add `tel` to `ownerView`'s postal address passthrough only if `ownerView`
enumerates address fields; it returns `contact.postalAddress` whole, so it
carries `tel` already.

- [ ] **Step 6: Add the form to `components/ContactsAdmin.tsx`**

`ContactsAdmin` already has everything this needs: `act(body)` at line 219 posts
to `/api/contacts/admin` with `user` merged in, then calls `refresh()`. The form
is one more caller of it.

Add a `GuestForm` component in the same file, rendered by an "Add a guest"
toggle above the pending group and by an Edit control on each `ContactRow`.
Fields: name, email, language, telephone, and the postal address (name, line1,
line2, postcode, city, country), plus the two consent checkboxes. Reuse the
field markup, labels and translation keys from `components/ContactForm.tsx` —
it is the same field set, and duplicating the labels is how the two forms start
disagreeing about what a field is called.

The fields the form holds:

```tsx
type GuestFields = {
  name: string;
  email: string;
  locale: string;
  tel: string;
  addressName: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  country: string;
  wantsEmailDigest: boolean;
  wantsPostcard: boolean;
};
```

The submit handler, for both modes:

```tsx
async function submit(form: GuestFields, editingId: string | null) {
  const response = await act({
    action: editingId ? "update" : "create",
    ...(editingId ? { id: editingId } : {}),
    name: form.name,
    email: form.email,
    locale: form.locale,
    wantsEmailDigest: form.wantsEmailDigest,
    wantsPostcard: form.wantsPostcard,
    address: {
      name: form.addressName,
      line1: form.line1,
      line2: form.line2,
      postcode: form.postcode,
      city: form.city,
      country: form.country,
      tel: form.tel,
    },
  });
  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    // The same three the public form can produce, named the same way.
    setError(body?.error ?? "unknown");
    return;
  }
  setError(null);
  setOpen(false);
}
```

Prefill the edit mode from the row the admin list already holds — `ownerView`
returns `postalAddress` whole, so it carries `tel`. Render `invalid_address` as
the "a postcard needs somewhere to go" message `ContactForm` already has, and
`blocked_contact` as a line saying that address was shown the door.

Follow `.claude/skills/apply-the-brand` for any colour or spacing decision.

- [ ] **Step 7: Run the four gates, and boot with the capability both ways**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
```

Then, per `AGENTS.md`, start the dev server twice — once with `contacts`
enabled in `content/config.json` and `CONTACTS_ENCRYPTION_KEY` set, once with
`contacts` disabled — and confirm the admin page offers the form in the first
case and 404s in the second. Check the printed OTP appears for the created
contact when mail is in `file` transport.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
W37: let the owner add and correct a guest

A contact could only exist after the person filled in the join form, which
made "keep a guest list" impossible from the owner's side. create is a thin
call to requestContact — already an upsert, already lands the row pending,
already anticipates created_via: "owner" — and update is keyed on id so the
commonest correction, the address itself, does not write a second row.

Neither can set status. Approving stays approveContact, which refuses an
unconfirmed address on purpose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Done when

- `content/example/config.json` has an `owner` and no `travellers`/`ownerEmail`.
- An old-shape config fails to load with a message naming the migration.
- A trip with no `people:` is credited to the owner alone; adding a person to
  `people:` changes the costs disclaimer, the structured-data author and the
  photobook byline together.
- A guest can be added from the contacts page with a telephone number, lands
  `pending`, receives a code, and can be posted to before confirming.
- All four gates pass, and the dev server boots with `contacts` on and off.

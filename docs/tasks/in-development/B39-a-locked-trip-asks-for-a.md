---
id: B39
title: A locked trip asks for a shared password, which nobody can revoke and everybody forwards
type: FEATURE
priority: medium
complexity: high
area: access, trips, auth, i18n, ui
found: "2026-09-01"
started: "2026-09-01"
---

# B39 — A locked trip asks for a shared password, which nobody can revoke and everybody forwards

## Why

A closed trip shows a form:

> **Test Trip** — This trip is private. Enter the password you were sent to
> read it. *Password: ____*

(`access.prompt`, `content/locales/en.json:9`; the form is
`components/TripPasswordForm.tsx`, drawn by both trip layouts.)

One secret, held by everybody who was ever sent it, forwarded onward without
the owner knowing, and revocable only by changing it — which cuts off the whole
family at once. `lib/tripGate.ts:75` already writes that limitation down as the
scheme's *"only revocation mechanism"*, and notes that to the reader a
revocation is indistinguishable from never having been let in: same form, same
sentence, no way to tell you are being asked for a *new* password rather than
getting the old one wrong.

It is also the wrong question to ask this audience. The people a journal is
written for are family who open it once a month from a link somebody sent them.
Asking them to keep a password is asking them to keep something they will lose,
and when they lose it the only recovery is a message to the owner.

**The replacement already exists and is already running.** `GuestSignIn`
(`components/GuestSignIn.tsx`) takes an address, posts to
`/api/auth/request`, and mails a six-digit code plus a one-tap link
(`signInUrl`, redeemed at `app/[user]/s/[token]/route.ts`). It is on the `me`
page today and is exactly the flow this asks for: *enter your email, we send
you the way in.* Nothing new has to be invented — the gate stops asking a
question the reader cannot answer and starts asking one they always can.

This reverses what B35 deliberately kept. That task argued passwords should
stay as a second, anonymous door for somebody who will not prove an address.
Overruled: the anonymous door is the one that cannot be revoked, and an address
is not a burden for this audience — it is the thing they already have and the
only thing that makes "let this person in, and not that one" possible at all.
B35's *Not doing* paragraph should be updated to point here rather than left
saying passwords stay.

## The thing that will go wrong

**Sending the mail must not be what grants access.** The obvious implementation
— enter an address, get a code, be let in — makes every closed trip readable by
anyone who can receive mail, which is everyone. It would be a strictly worse
gate than the password it replaced.

Today's flow is safe precisely because it does not do that.
`/api/auth/request` issues a guest code to **any** address (only `kind:
"agent"` is checked, `route.ts:77`), and that is fine, because the session it
produces grants nothing by itself: reading is decided afterwards by
`isPersonOn` for the trip's people and by an approved contact's grant. The
session is an identity claim, not a key.

So the rule for this task, stated once so nobody has to re-derive it: **the mail
proves who you are; the grant decides what you may read.** Signing in must
leave a stranger seeing exactly what they saw signed out. The uniform `202` and
the "if this address has access, a code is on its way" copy stay as they are —
a different answer for a known address turns the form into a way of asking who
reads somebody's journal.

**Sequencing follows from that, and it is not optional.** `mayReadTrip`
(`lib/tripGate.ts:26`) does not consult grants yet — B41 is what wires them in.
Remove the password before B41 lands and a `visibility: guest` trip becomes
readable by nobody except the people listed on it: every guest in the journal
is locked out with no way back. **B41 must ship first.** B35 should also land
first, or its dead per-trip code gets tangled into this.

## Work

- Replace the password form in both layouts (`app/[user]/trips/[trip]/layout.tsx:49`,
  `app/[user]/(trip)/layout.tsx:28`) with the sign-in flow. `GuestSignIn` takes
  only `{ username }` and the session is journal-wide, so redeeming lands the
  reader back on the trip; check that the return path actually works from a
  trip URL rather than assuming it.
- Say the right thing to somebody signed in who still may not read it. That is
  a different sentence from "sign in", and it is the one B41's guests will hit
  when they open a `private` trip: *you are signed in, this one is not shared
  with you, ask the owner.* Without it they will sign in repeatedly and think
  it is broken.
- Remove the password machinery: `app/api/trip-access/route.ts`,
  `components/TripPasswordForm.tsx`, `hashTripPassword`, `verifyTripPassword`,
  `signTripToken`, `verifyTripToken`, `tripCookieName`, `TRIP_COOKIE_MAX_AGE`
  and `isRestricted` in `lib/access.ts`, `tripLockReason` in `lib/tripGate.ts`,
  the `passwordHash` field (`lib/types.ts:280`, parsed at `lib/trips.ts:308`),
  `scripts/trip-password.mjs` and the `trip:password` npm script.
- **Keep `accessSecret()`** (`lib/access.ts:73`). It looks like part of this and
  is not — `lib/agentConfirm.ts:67` signs every destructive-operation code with
  it. Removing it with the rest breaks agent confirmations. If `lib/access.ts`
  ends up hollow, move the function rather than deleting it.
- `assertTripAccessConfig` (`lib/access.ts:206`) currently fails the boot when a
  `guest` trip has *no* hash. Invert it: a `passwordHash:` left in a trip.md is
  now a line that does nothing, and a trip whose owner believes it is protected
  by one is the dangerous case. Fail, or warn loudly, on its presence.
- `exportZip` strips `passwordHash` on the way out (`lib/exportZip.ts:66`) —
  that can go, but only after existing content no longer carries the field.
- `digestableTrips` (`lib/digest/visibility.ts:33`) excludes password-protected
  trips outright. With no passwords the whole branch disappears; combined with
  B35 the function collapses to "indexable, or granted".
- Locale strings in all three of `en`, `de`, `hu`: the seven `access.*` keys
  (`content/locales/en.json:8-14`) go, and the new copy has to be written in
  each. `lib/i18n.ts` carries the key union and must match.
- Existing content: any trip carrying `passwordHash:` needs the line removed and
  its `visibility` reconsidered. A trip that was `guest` + password becomes
  `guest`, readable by the journal's guests — which may be more people than the
  password ever reached. Say so in the deploy note; this is a widening, and it
  happens silently on the trips that were most deliberately closed.

Not doing: changing what a guest session grants, or how somebody becomes a
guest — that is B41, B33 and B37. This task only changes what the gate asks for.

## Acceptance

- No trip anywhere shows a password field, and `grep -rn "passwordHash\|trip-access" app lib components scripts` returns nothing.
- A closed trip offers the sign-in form; submitting an address answers `202`
  whether or not that address has access, and a `.eml` is written for it.
- **A signed-in address with no grant and not on the trip reads nothing** —
  not the page, not the metadata, not the RSC payload. This is the test that
  matters most; write it first.
- A person listed in `people:` signs in and reads the trip.
- An approved contact signs in and reads the journal's `guest` trips, and is
  still refused its `private` ones.
- A signed-in reader who may not read a trip is told that, not shown the
  sign-in form again.
- `accessSecret` still exists and agent confirmations still work — assert with
  an existing `agentConfirm` test, not by inspection.
- The boot fails or warns on a leftover `passwordHash:`.
- All three locales have the new copy and no orphaned `access.*` keys.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.

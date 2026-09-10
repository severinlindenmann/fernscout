---
id: B1363
title: A stranger who takes the landing page's WhatsApp door is told to go away
type: FEATURE
priority: high
complexity: high
area: whatsapp, signup, onboarding
found: "2026-09-10T18:25:28Z"
started: "2026-09-10T18:26:10Z"
merged: "2026-09-10T18:48:09Z"
---

# B1363 — A stranger who takes the landing page's WhatsApp door is told to go away

## Why

B1310 put "Per WhatsApp loslegen" on the landing page beside "Start writing",
on the reasoning that "the channel explains itself to strangers already
(wa.strangerReply)". The owner walked it on 2026-09-10, from a number no
journal owns, and the explanation is a dead end:

> This number writes into somebody's private travel journal on Fernscout and
> cannot help with that. If this is your first time here, sign in at
> https://fernscout.ch.

`components/LandingSections.tsx:112` opens the chat with a prefilled "Hallo";
`lib/whatsapp/dispatch.ts:117` looks the sender up in B1064's tel registry;
`:147` sends that sentence to everyone it does not find. So the one door on
the landing page that a person with no journal is most likely to press is the
one door that cannot let them in — and it sends them back to the web signup
they were trying to avoid, without so much as a link to the right page.

The rest of the signup is web-only and always has been: address code
(`/api/auth/signup/request`), number proof, then nine required fields at
`POST /api/v1/journals`, each deliberately refusing a default. WhatsApp
already carries *step two* of it — B1234's `FS-XXXXXXXX` token, where the
inbound message is itself the proof — which is the same machinery this needs,
pointed the other way.

**What it costs to leave alone**: the person this software is for — the
71-year-old of B1302, the person with no agent of their own — is exactly the
person who presses a WhatsApp button rather than filling in a form. Today
they meet a refusal written for somebody who dialled a wrong number.

## Work

A **scripted** onboarding for an unbound number, in `lib/whatsapp/onboarding.ts`,
driven from the `!username` branch of `dispatch.ts` and reached before the
stranger sentence.

Scripted and not model-driven, for three reasons that all point the same way:
B1077 (Meta prohibits general-purpose AI chatbots, and the argument that this
instance is compliant rests on the helper serving one narrow business
process — a model that talks to strangers widens the surface that argument is
made over); the disclosures have legal weight and must read identically every
time (B1063, and AGENTS.md's own finding that a sentence with legal weight
cannot be composed fresh); and a stranger's turn cannot spend a journal's
credits because there is no journal yet to spend them.

- **State**: one JSON file per number under `dataDir()`, not `contentRoot()`
  — this is transient instance state with no journal to belong to (B636's
  reasoning), and `content/` takes nothing but a journal (B510). Swept on
  read past a 24h TTL. Nothing like it exists today: every per-number marker
  (`binding.ts`, `toldOnce.ts`) is keyed on a username a stranger has not got.
- **The script** is the same list of questions the web wizard draws and the
  guide prints — `firstQuestions()` in `lib/api/agentCopy.ts`. Order: language
  (three buttons — the only way to know what to say next, since a webhook
  carries no `Accept-Language`), then the disclosure, then email, mailed code,
  title, username, ownerName, ownerNickname, visibility (buttons),
  whether readers get a second language (buttons, with what that commits them
  to said out loud — B294/B277), baseCurrency (said to be permanent — B839).
- **The number is already proven** by the message arriving, which is the whole
  of B1234's insight; it goes on as `ownerTel`/`ownerTelProvenAt` with method
  `whatsapp-inbound`, so B1064's tel lock names the new journal and the
  channel is theirs from the next message on with no linking step at all.
- **No agent token is minted.** The reply is the journal's URL and a
  single-use sign-in link (`issueRelayLink`), and the welcome mail carries the
  standing one. The next message that number sends walks into the ordinary
  bound-number path — `hasBeenGreeted` false, so B1058's three disclosures and
  B1138's acknowledgement gate happen exactly where they already do.
- **Ceilings**, keyed on the number and on the address rather than on an IP
  (every webhook shares one): a stranger must not be able to make this server
  send mail, or create journals, at will.
- **A way out at every step** — "stop"/"abbrechen" — and `STOP` from a reader
  keeps working ahead of all of it (B1062).

Not doing here:

- No model call anywhere in the stranger path, and no writing of a day: the
  flow ends at a signed-in owner of an empty journal, the same place
  `components/SignupWizard.tsx` ends.
- No first trip. The wizard's `trip` step is web-only for now; the bound-number
  helper can make one on the next message.
- `tagline`, `startLocation`, `units`, `displayCurrencies` stay unasked, for
  the reason the wizard already gives: each is correctable later and does not
  belong in front of somebody who has not written a day.
- The landing button's copy and the stranger sentence for numbers that are
  *not* onboarding (a wrong number, a reader) are unchanged.

## Acceptance

- A number no journal owns writes anything to the WhatsApp number and is
  walked to a created journal without opening a browser, in German, English
  and Hungarian.
- `content/<new-user>/config.json` carries `owner.tel`, `owner.telProvenAt`
  and `owner.telProvenMethod: whatsapp-inbound`, and
  `content/.registry/tel/<e164>.json` names the new journal.
- The next message from that number is answered by the ordinary bound path:
  B1058's disclosure, then B1138's acknowledgement gate.
- A taken username is corrected in the chat rather than starting over.
- "stop" at any step ends it and leaves nothing behind; a reader's `STOP`
  still reaches `wa.stopReply`.
- No model call is made for any of it — provable from the logs and from the
  absence of a `helper_sessions` row.
- `npm run verify` green, and the flow driven end to end against a local
  checkout with the dry-run WhatsApp backend.

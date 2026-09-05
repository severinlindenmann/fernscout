---
id: B449
title: The Hungarian reader guides were written by an agent and have never been read by a speaker
type: DOCS
priority: medium
complexity: low
area: i18n, guides
found: "2026-09-05T12:37:30Z"
started: "2026-09-05T15:23:37Z"
merged: "2026-09-05T15:33:11Z"
---

# B449 — The Hungarian reader guides were written by an agent and have never been read by a speaker

## Why

The three Hungarian reader guides — `docs/guides/hu/{guest,creator,buddy}.md`,
about 2,100 words — were written by an agent alongside the German ones and have
never been read by anybody who speaks the language. Nothing failed, which is
the point: every check in `test/guides.test.ts` was per-file, so a guide could
lose a paragraph, name a button something the button is not called, or say
something ungrammatical, and the suite stayed green.

What that process actually produced, found by reading the Hungarian against the
English original:

**The Hungarian was translated from the German, not from the English, and
inherited the German's omissions.** `docs/guides/en/guest.md:16` has step 2 as
*"Type the email address the invitation was sent to, and press **Send me a
code**"*, with a screenshot of the form after it and a screenshot of the code
field after step 3. `docs/guides/de/guest.md:16` drops the button and both
figures; `docs/guides/hu/guest.md:18` drops exactly the same three things and
nothing else, and its wording tracks the German clause for clause. The two
figures were on disk the whole time (`guide-signin-form-en.webp`,
`guide-signin-code-en.webp`) and referenced by no translation. A Hungarian
reader stuck on the sign-in form was the only person this hurt.

**A control named as something the interface does not say.**
`hu/guest.md:132` told the reader to press **Kilépés**, which is
`home.revoke` — the button that signs *one device* out of the list. The button
the sentence means is `me.signOut`, **Kijelentkezés**. The same page uses the
right word nine lines earlier, so the guide contradicted itself.

**An untranslated English word with an established Hungarian equivalent
already in the product.** `hu/creator.md:78` and `hu/buddy.md:7` said
*buddy-hivatkozás*. The interface has never used the word: `guides.buddy.title`
is *Útitársaknak* and the owner's own control is *Link az íráshoz*.

**A menu item quoted wrongly.** `hu/guest.md:66` and its note at :73 called
the iOS share-sheet entry *Főképernyőhöz adás*. A Hungarian iPhone says
*Hozzáadás a Főképernyőhöz*, and so does our own `push.iosInstall`. The whole
purpose of that note is to tell the reader what their phone will say.

**Sentences that are wrong rather than merely clumsy.** `hu/buddy.md:66` read
*"a napló nem az övé íráshoz"* — English *"the journal is not yours to write
to"* had become *his/hers*, attached to a stranded dative. `hu/guest.md:66`
had *az alkalmazások mellett*, "beside the apps", for *past the apps* — the
reader is being told where to scroll. `hu/guest.md:33` had *amint új indul*,
"as soon as a new one starts", for *the moment a new one is sent*.
`hu/creator.md:46` had *maradjon hiányzó*, which is not a construction
Hungarian makes. `hu/creator.md:64` ended a sentence with *nem utanként egy*, a
straight transcription of English *"not a decision per trip"*.
`hu/guest.md:93` opened a subjunctive — *Ha inkább egyáltalán ne kérdezzenek
róla* — with no matrix clause for it to hang on. `hu/buddy.md:14` lost the
object of its sentence: *"ha a tulajdonos kézzel írt bele"* says the owner
wrote *into the trip* by hand, where the English says they wrote *you* into it.

**B289 is not broken here, and is still unwritten.** The guides interpolate no
names, so the suffix constraint does not bite in this prose. It is load-bearing
in `hu.json` and obeyed: `me.askOwnerNamed`, `trips.hiddenSignedInBody` and
`postcard.page.mismatchOne` all place `{name}` in subject position, and
`del.pageLead` and `welcome.token` use the `a(z)` dodge for the article. Three
independent authors have now re-derived the same rule and none of them wrote
it down. B289 stays open on its own terms.

**None of this makes the guides *good* Hungarian, and this task cannot claim
it does.** An agent can check a translation against its source, against the
dictionary and against a grammar rule it can name. It cannot tell whether the
result sounds like a Hungarian product or like a translation, and saying
otherwise would be the same failure the title is about.

## Work

Done in this branch — the corrections above, each one against a rule that can
be named:

- `hu/guest.md` — the missing button and the two missing figures restored;
  *amint újat küldünk*; *hogyan jutottál be* (the English is past tense);
  *az alkalmazásokon túl*; *Hozzáadás a Főképernyőhöz* in both places;
  the subjunctive given its matrix clause; **Kijelentkezés** for the sign-out.
- `hu/creator.md` — the stranded `-vá` complement in the opening rewritten;
  *akkor hiányozzon*; the *per trip* ellipsis spelled out; *útitárs-hivatkozás*;
  the dropped *until you approve them* clause restored.
- `hu/buddy.md` — *útitárs-hivatkozást*; the dropped object in the credit
  sentence; the *"not yours to write to"* sentence rebuilt.
- `de/guest.md` — the same missing **Code schicken** button, since it is the
  source of the Hungarian gap and one clause to fix.
- `test/guides.test.ts` — one new assertion: headings, numbered steps, bullets
  and bold runs must match across `en`/`de`/`hu` for each guide. Bold is the
  load-bearing one; in these pages it names a control the reader has to press,
  and it is what the dropped button showed up as. Verified by mutation: it
  fails when a bold marker is removed from one language.

Not doing, deliberately:

- Not touching register, rhythm or word choice on instinct. Every change above
  answers to a rule; anything that only answered to taste was left alone and
  written into the list below.
- Not renaming `út` → `utazás` across the guides — and the second pass
  settled it the other way round: `út` is the word (see item 7 below).
  `hu.json` is the file that disagrees, and it is captured as B485 rather than
  edited here, because B481 was rewriting the same file on a parallel branch.
- Not adding the two English screenshots to `docs/guides/de/guest.md`. The
  German guide shows German captures; dropping two English ones into it would
  be worse than the gap. Hungarian already carries a note saying its
  screenshots are English, which is why they belong there.

## The eight items, decided

**The owner decided not to wait for a Hungarian speaker.** The instruction was
to settle these items on the best judgement available, accepting a small error
rate, rather than leave the ticket parked indefinitely on a person who may
never appear. That is a deliberate, owner-sanctioned change to how this task
closes, and the Acceptance section below was rewritten to match it. It is
recorded here so it does not read as an agent quietly moving the goalposts.

Each decision names the rule it rests on. Three are marked *lower confidence*:
they are the ones where the rule is idiom rather than grammar, and they are the
short list a speaker would check if one ever does read this.

1. **Register — informal *te*, unchanged.** The interface is being made
   consistently informal in both German (B432, merged) and Hungarian (B481, in
   flight), so informal is the house style; a guide in a different register
   from the buttons it tells you to press would be two voices in one product.
   Checked mechanically: `Ön`/`Önnek` appears nowhere in
   `docs/guides/hu/`, so the guides are already internally consistent and no
   edit was needed.

2. **`hu/creator.md:4` — changed.** *A legmeglepőbb elsőként:* →
   **Kezdjük a legmeglepőbbel:**. Rule: Hungarian does not license the
   verbless English fronting *"The most surprising thing first:"* — a
   topicalised fragment of that shape needs a finite verb. `Kezdjük a X-vel`
   is the ordinary Hungarian way to say "X first", and it keeps the bold
   clause that follows exactly as it was.

3. **`hu/creator.md:15` — repaired.** *… amit karbantartani, megtanulni és
   amibe belépni kell* → *… amit karban kell tartani, meg kell tanulni, és
   amibe be kell lépni.* Two rules, both nameable. First, a single `kell`
   cannot serve two relative clauses whose pronouns carry different cases
   (`amit` accusative, `amibe` illative); each clause needs its own. Second,
   with `kell` a verbal prefix separates and precedes it — *karban kell
   tartani*, *be kell lépni*, never *karbantartani … kell*.

4. **`hu/buddy.md:14` — *fel vagy tüntetve*.** *Megnevez* is "to name, to
   specify which one"; *feltüntet* is the verb for entering a name into a
   visible list — a credit, a byline, a table. The English is *credited*, and
   AGENTS.md is explicit that `people:` is the owner's editorial statement of
   whose trip it was, i.e. a byline. So: **Fel vagy tüntetve** az úton.
   *Lower confidence* — the two verbs overlap, and this rests on which one a
   Hungarian byline uses rather than on a grammatical rule.

5. **`hu/guest.md:98` — rewritten.** *más nyelvet választanál, amelyen
   írnak neked* → *megváltoztatnád a nyelvet, amelyen írnak neked.* Rule: a
   restrictive relative clause hanging off an indefinite antecedent
   (*más nyelvet*) needs the correlative *olyan… amelyen*; with a definite
   antecedent (*a nyelvet*) the bare *amelyen* is standard. Making the
   antecedent definite is the smaller repair, and it also matches the
   definite conjugation of its neighbours — *javítanád*, *leállítanád*,
   and now *megváltoztatnád*.

6. **`hu/creator.md:64` — the distributive dropped.** *utanként meghozott
   döntés* → *az egyes utakról külön hozott döntés.* `-nként` attaches
   productively to time and measure words (*naponként*, *fejenként*), not to
   an arbitrary count noun, and *utanként* additionally collides with the
   reading "per road". Rephrasing away from the distributive entirely, as the
   item asked, says what the English says without inventing a form.

7. **`út`, not `utazás` — decided by the owner, and already satisfied.**
   `út` is the idiomatic noun for one named journey; `utazás` survives only
   where the sense is travel in the abstract. Checked: `utazás` occurs
   nowhere in `docs/guides/hu/`, so the guides needed no edit. `hu.json` is
   the file that disagrees — about thirty strings, `gate.privateTitle`,
   `del.tripTitle`, `landing.trips` and the rest — and it is deliberately not
   touched here because B481 is rewriting it on a parallel branch. Captured as
   **B485**, which carries the decision.

8. **The three iOS steps — closed against `hu.json`, and one disagreement
   found.** No iPhone was available, so Apple's published Hungarian wording is
   taken as authoritative and the product's own strings are the check that the
   guide and the interface say the same thing. `push.install.step1`
   (*Koppints a Megosztás ikonra a Safariban*), `push.prompt.yes`
   (*Igen, értesítsetek*), `push.prompt.never` (*Ne kérdezzétek többet*) and
   `me.notifyTitle` (*Értesítések*) all match the guide exactly. One did
   not: `push.iosInstall` and `push.install.step2` both say **Hozzáadás a
   kezdőképernyőhöz**, where the guide said *Hozzáadás a Főképernyőhöz*
   — in two places, while its own surrounding prose already said
   *kezdőképernyő*. The first pass's note that this wording came from
   `push.iosInstall` was simply wrong about what that string says. Both are now
   *kezdőképernyőhöz*, so the guide agrees with itself and with the product.
   *Lower confidence* — Apple has used both words for the Home Screen across
   iOS versions, and with no device to look at, agreeing with our own product
   is the tie-break rather than proof of Apple's current string.

## What changed in the second pass

- `docs/guides/hu/creator.md` — *Kezdjük a legmeglepőbbel:* (item 2); the
  `kell` chain rebuilt with one `kell` per verb and separated prefixes
  (item 3); *az egyes utakról külön hozott döntés* (item 6); the paragraph
  touched by item 3 re-wrapped, since the edit left a two-word line.
- `docs/guides/hu/buddy.md` — **Fel vagy tüntetve** for the credit line
  (item 4).
- `docs/guides/hu/guest.md` — *megváltoztatnád a nyelvet, amelyen írnak
  neked* (item 5); **Hozzáadás a kezdőképernyőhöz** in the step and in the
  note that tells a Hungarian iPhone owner what their phone will say (item 8).
- No change to `content/locales/hu.json`, to the German or English guides, or
  to `test/guides.test.ts`. The parity assertion added in the first pass still
  passes: no bold run was added or removed, only its contents changed.
- New capture: **B485**, `hu.json`'s `utazás`/`út` split.

## Acceptance

**Rewritten, on the owner's instruction.** This section used to say the task
was closable only once a Hungarian speaker had worked through the eight items.
The owner decided not to wait for one, so as written the ticket could never
close. What replaces it is checkable by anybody:

- `npx vitest run test/guides.test.ts` passes — including the parity
  assertion that headings, numbered steps, bullets and bold runs match across
  `en`/`de`/`hu` for all three guides.
- `npm run verify` passes.
- Every control the Hungarian guides name in bold is named identically in
  `content/locales/hu.json`: **Megosztás**, **Hozzáadás a
  kezdőképernyőhöz**, **Igen, értesítsetek**, **Ne kérdezzétek többet**,
  **Értesítések**, **Kijelentkezés**.
- `grep -c utaz docs/guides/hu/*.md` is zero: a trip is `út` throughout.
- Each of the eight items has a recorded decision above, and the three
  lower-confidence ones (4, 8, and the idiom half of 2) are marked as such —
  that list, not the whole ticket, is what a Hungarian speaker would review if
  one ever appears.

What the title claims remains true — no Hungarian speaker has read these
guides. That is now a known and accepted state of the file rather than an open
item, and B485 carries the one piece of work this pass deliberately left
undone.

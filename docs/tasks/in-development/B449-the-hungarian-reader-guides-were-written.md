---
id: B449
title: The Hungarian reader guides were written by an agent and have never been read by a speaker
type: DOCS
priority: medium
complexity: low
area: i18n, guides
found: "2026-09-05T12:37:30Z"
started: "2026-09-05T15:07:26Z"
session: e5747799-fd3e-4d40-a335-82fa4e24333e
claimed: "2026-09-05T15:07:26Z"
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
- Not renaming `út` → `utazás` across the guides. `hu.json` is itself split
  between the two (`gate.privateBody` says *utazás*, `me.buddyAgent` says *út*)
  and picking a winner is a decision about the product's vocabulary, not a
  translation fix.
- Not adding the two English screenshots to `docs/guides/de/guest.md`. The
  German guide shows German captures; dropping two English ones into it would
  be worse than the gap. Hungarian already carries a note saying its
  screenshots are English, which is why they belong there.

## What only a Hungarian speaker can settle

This is the whole of what is left, and it should take about ten minutes. Read
only the lines named; the rest was checked against the English.

1. **Register.** The guides use informal *te* throughout. Is that right for a
   stranger's travel journal, or should a guide be neutral? (`hu.json` is
   informal too, mostly — B481 covers the four strings that are not.)
2. **`hu/creator.md:4` — "A legmeglepőbb elsőként:"** for *"The most
   surprising thing first"*. Understandable; is it something a Hungarian text
   would actually write, or is it visibly a translation?
3. **`hu/creator.md:15` — "még egy dolog lenne, amit karbantartani, megtanulni
   és amibe belépni kell."** Two relative pronouns sharing one *kell*. Legal?
   Readable?
4. **`hu/buddy.md:14` — "Meg vagy nevezve az úton"** for *"You are credited on
   the trip"*. Is *meg van nevezve* the word, or should it be *fel vagy
   tüntetve*?
5. **`hu/guest.md:98` — "más nyelvet választanál, amelyen írnak neked"**. The
   relative clause is doing something awkward. Say it better.
6. **`hu/creator.md:64` — "utanként meghozott döntés"**. Is *utanként* the
   distributive form of *út* you would write, or does it need rephrasing away?
7. **`út` or `utazás` for a trip?** The guides say *út* everywhere and the
   interface says both. One answer, and then B481's sibling can carry it into
   `hu.json`. This is the one item on the list that changes more than a
   sentence.
8. **The three iOS steps in `hu/guest.md:58-78`** against an actual Hungarian
   iPhone, if one is to hand. The menu names were corrected from Apple's
   Hungarian wording rather than from a device.

## Acceptance

**This task cannot be closed by an agent, and nothing here pretends otherwise.**
The corrections above are checkable and are done; `npm run verify` passes and
the new parity assertion holds. What the title claims — that no Hungarian
speaker has read these — is still true after this branch merges.

It is accepted when a Hungarian speaker has worked through the eight items
above and either confirmed them or said what to change. Until then it stays in
`testing/` as a ticket waiting on a person, not on a build.

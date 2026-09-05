---
name: describe-a-traveller
description: Ask somebody how they would like to be drawn on a Fernscout trip, show them the figure, and write it into trip.md. Use when the user says "add me to the trip", "how do I look", "draw us", "add the kids", "change my hair", or when a new trip needs its travellers.
---

# Describe a traveller

Every Fernscout journal opens with figures walking. Who they are is
`travellers:` in a trip's `trip.md`, or in the journal's `config.json` as a
default. This skill is how that block gets written, and it is a conversation
rather than a form.

## The one rule

**Ask. Never infer.**

A person telling you their own hair is short and black is stating a fact about
themselves, and recording it is the whole job. Guessing it is the thing
`AGENTS.md` forbids, and the four ways it happens:

| Never from | Because |
| --- | --- |
| **A name** | A French-sounding name says nothing about anybody's hair. |
| **A photograph on the trip** | The trip is full of pictures of these people. Reading one to decide this is a guess about a person from an image, presented to their family as their own choice. |
| **A country** | A trip to Vietnam does not populate the party. |
| **The gaps** | Somebody who says "short dark hair" and stops gets the **default** skin tone, and you say so. Not a plausible one. |

An empty field beats a plausible fiction, exactly as it does for the prose.

## Steps

### 1. Find out who is being drawn

The trip's `people:` block is who was there. It is not the same list — a party
may have figures nobody is named for (a child who has no address), and people
with no figure. Ask who should appear.

### 2. Ask, once, openly

> **"How would you like to be drawn?"**

One question. Not twelve. The person answers with as much or as little as they
like, and *whatever they leave out stays at the default* — that is what step 5
is for.

Do not walk them through the vocabulary field by field. Somebody who says
"short black hair, glasses, I usually wear green" has answered four things in
one sentence, and being asked about their eye colour afterwards is the form
this skill exists to avoid.

### 3. Map it onto the vocabulary

```bash
curl -s localhost:3000/api/v1/<user>/travellers/presets | jq .
```

That is the whole vocabulary and twelve **starting points**. Offer a starting
point when an answer is sparse, as an offer:

> "There's a `south-asian` starting point — shall I begin from that and change
> the hair?"

Three things about starting points, and the third is not optional:

- Each is **one common combination out of many**, not a rule about anybody.
  Say so. Expect to be corrected; that is the point of them.
- They are named for regions because that is what makes them findable in a
  sentence, and for no other reason.
- **The name is never written to a file.** Resolve it to the attributes under
  `resolve` and write those. `POST …/trips` refuses a `preset` key by name.
  A preset name in a trip file is a claim about somebody's background that
  the owner did not think they were making, and it stops being true the
  moment they change the hair.

Working on disk instead of over the network? The same list is
`lib/travellers/vocabulary.ts` and `lib/travellers/presets.ts`.

### 4. Show them

**This is the step that makes the rest honest.** A person cannot confirm a
description they cannot see, and reading `skin: medium-deep, hairStyle:
braids` down a phone is not confirmation.

```bash
# over the network
open "localhost:3000/api/v1/<user>/travellers/preview?figure=$(jq -rn --argjson f \
  '{"skin":"medium-deep","hair":"black","hairStyle":"braids"}' '$f|@uri')"

# on disk, with nothing running
npm run travellers -- --party '[{"skin":"medium-deep","hairStyle":"braids"}]' --out /tmp/you.svg
```

`?party=[…]` draws the whole group as the hero will actually arrange it, which
is worth doing once the party is more than one — the arrangement is part of
what they are agreeing to.

### 5. Read back what you set **and what you did not**

```
skin: medium-deep
hair: black
hairStyle: braids
eyes: brown          ← default, you didn't say
build: average       ← default, you didn't say
age: adult           ← default, you didn't say
```

Both halves. A silent default reads as a choice, and this is the line that
stops it.

### 6. Write it on yes

Into a new trip:

```bash
curl -X POST localhost:3000/api/v1/<user>/trips \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"id":"kerala-2027","title":"Kerala","start":"2027-02-01","end":"2027-02-20",
       "travellers":[{"for":"ana@example.test","skin":"medium-deep","hair":"black","hairStyle":"braids"},
                     {"age":"child","skin":"medium-deep","hair":"black","hairStyle":"coils"}]}'
```

Or by hand in `trip.md`:

```yaml
travellers:
  - for: ana@example.test
    skin: medium-deep
    hair: black
    hairStyle: braids
  - age: child
    skin: medium-deep
    hair: black
    hairStyle: coils
```

For the journal's default party — used by any trip that does not say for
itself — the same block goes in `content/<user>/config.json`.

## What the fields mean

`GET …/travellers/presets` is the authority. The three worth knowing before
you ask anything:

- **`age`** is a height multiplier and nothing else. It does **not** grey the
  hair: somebody with an unchanged head of black hair at seventy should not
  have to fight the renderer. Grey and white are hair colours like any other.
- **`for`** ties a figure to an address in `people:`. Optional, and it is the
  only thing the two blocks ever say to each other — nothing in `travellers:`
  can change who may write to the trip.
- **`eyes`** is two pixels wide in the hero. It is in the vocabulary because
  it reads in the preview and the photobook. **Do not spend a question on it.**

## There is no gender field

Deliberately, and it comes up. Everything it would control is already
something the person chose directly — hair style and length, clothing colours,
`build`. A separate field would either do nothing, or make the software assert
something about a person, and it would leave a non-binary traveller with a
two-way switch and no right answer.

If somebody says "I'm a woman", that is not a field to fill in — it is context
for what to *offer*. Ask what they'd like their hair and clothes to be, or
suggest a starting point and let them correct it.

## Red flags — stop

- About to look at a trip photograph to decide what somebody looks like.
- Filling in a tone or a style the person did not mention.
- Writing `preset: european` into a file.
- Reading back only what you set, not what stayed at the default.
- Asking twelve questions instead of one.
- Writing the block before they have seen the picture.

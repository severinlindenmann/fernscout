---
name: check-a-drawing
description: Look at something this software draws — the travel animation, the traveller figures, a day card, a print layout — using the workbenches at /docs/branding. Use when a change is to an SVG, an animation or a card rather than to a function, when somebody says a thing "looks wrong" or "feels off", or before claiming a drawing is fixed.
---

# Checking a drawing

**A drawing is the one output no test can check.** The code for an aeroplane
whose wings rake the wrong way is exactly as correct as the code for one whose
wings do not — it typechecks, it lints, it passes every assertion, and it is
wrong. Somebody has to look, and until `/docs/branding` existed that meant
editing a duration constant, screenshotting, and reverting.

Do not do that any more. **Go to the bench.**

| The complaint | The bench | The file it names |
| --- | --- | --- |
| the animation / a vehicle / a city / the timing | `/docs/branding/animation` | `components/TravelScene.tsx`, `components/travel/*` |
| a person, a figure, what a word draws | `/docs/branding/travellers` | `lib/travellers/render.ts` |
| a day, a banner, a draft, the timeline | `/docs/branding/day` | `components/StoryPager.tsx` |
| a margin, a bleed, a card, a book page | `/docs/branding/print` | `lib/postcard/spec.ts`, `lib/photobook/spec.ts` |

Live at `https://fernscout.ch/docs/branding`, and on any local checkout at
`/docs/branding`. Nothing there needs a journal, a database, a session or a
capability — the pages are above all of that, which is why they are the fastest
thing in this repository to open.

## The bench proves the drawing, not the feature

A bench renders the real component with props you hand it, which is what makes
it trustworthy about *shape* — and blind to whether anything on the site ever
passes those props. Both halves have to hold before a visible change is done:

1. **It draws correctly** — the bench, held still.
2. **Something real reaches it** — the page a reader opens, on content that
   existed before your branch.

The second is the one that gets skipped, and it fails silently. B42 drew a
reader's own clock beside a day's local time; the drawing was right, and it
appeared on exactly two days in the world, both of them edited by the same
change to carry the field that switches it on. Every other day rendered as
before. Nothing was broken and nothing worked. B1090.

So when a change adds a field, a prop or a condition that decides whether a
thing is drawn at all, the question is never "does it draw" — it is **how many
of the things a person will actually open satisfy that condition today**. If
the answer is none, the feature is inert and the ticket is not finished.

## The one move that matters: hold it still

The animation bench has **Hold at a moment** and a slider. Use it. Every bug
found in that component was found by stopping it:

- a wheel spinning off its axle on its own orbit
- an aircraft with both wings raked forward, flying backwards
- a locomotive at the back, pushing its own carriages
- the party left standing on open water after the far bank had gone
- a marker that crossed a fortieth of the lane it was meant to cross

None of those is visible at six seconds a leg. All of them are obvious held at
40%.

## Isolate before you diagnose

The benches are arranged so that **which section shows the fault is the
answer**. Work down, not across:

1. **Does the piece alone look wrong?** *Vehicles*, *Surfaces*, *Skylines*, or
   a row in *Travellers*. Then it is a drawing — an SVG path, a colour, a
   proportion — and the timing is innocent.
2. **Do the pieces look right and the whole scene wrong?** Then it is timing or
   layering in `TravelScene.tsx`: a curve, a window, a `z` order, something
   moving against the camera instead of with it.
3. **Right at one width and wrong at another?** Resize to 390px before opening
   anything. Half of what reads as a drawing fault is a percentage that turned
   out to be of the wrong box.

Report it that way too. "The travel scene looks wrong" is an afternoon of
bisecting; "the plane in `Vehicle.tsx` has its wings on backwards" is ten
minutes.

## Four traps, each of which cost a round here

- **A stale dev server.** `PORT=3006 npm run dev` when 3006 is taken prints one
  line about `EADDRINUSE` and exits, and the browser happily serves you somebody
  else's server. You will conclude your edit did not apply. Check the log, or
  pick a port nobody is on.
- **`originX` / `originY` on an SVG element are fractions of the bounding box**,
  not user units. Rotating about a point means an outer `<g transform="translate(x y)">`
  and `transformOrigin: "0px 0px"` on the inner one.
- **An `<svg>` with only a `viewBox` takes its intrinsic size from it.**
  `className="absolute inset-x-0"` will not stretch it; it sat 100px wide at the
  far edge of the frame and looked like part of the scenery.
- **`x: "120%"` on a motion element is 120% of *that element*.** A 115px car
  crossed 144px of a 710px frame. If a percentage should be of the frame, the
  wrapper has to be the frame — `inset-x-0`, with the drawing in a `w-fit`
  child.

## Adding a bench

The section is meant to grow. A new one is three things:

1. `components/branding/<Thing>Bench.tsx` — a client component. Render the
   **real** component with the real props; a copy drifts and then proves
   nothing.
2. `app/docs/branding/<thing>/page.tsx` — copy any of the four. `robots: {
   index: false, follow: false }`, and a link back to `/docs/branding`.
3. A row in `BRANDING_BENCHES` in `lib/docs.ts`, which is what the hub renders.
   Say what it isolates and name its source file.

If the component needs a provider that throws outside a journal — `useMoney`,
`useI18n` — supply a plain fixture rather than reaching for real content. If it
needs a *seam* to be held still, add one, keep it out of the site's own call
sites, and say so in its doc comment: `TravelScene`'s `at`, `party` and `sky`
are the precedent.

**Do not put content in a print bench.** A photobook and a postcard already
have previews built from the same millimetres, and they live inside a journal
because they need real photographs and an owner. Two layout engines drift, and
the one that drifts is the one nobody printed.

## What this skill is not

`test-in-a-browser` is for a page that needs a signed-in owner and a capability
switched on. `test-the-live-site` empties `testing/` against the deployed
instance. This one is for the narrow case where the question is *does this
picture look right*, and the answer is not in a test file and never will be.

# Trip planner: map, legs, ideas and a travel guide

A design, not a description of built code. Nothing here exists yet beyond the
planner it starts from; check the code before relying on any of it.

Fernscout already plans upcoming trips: the studio's planner
(`components/studio/plan/`) takes places through the composer, keeps nights or
dates, reorders with ▲▼ or dragging, undoes, saves offline, and has money and
links panels. Who may see a trip is already decided by invites, trip
visibility, the trip link and `plan.readers` (`lib/planner/types.ts`). This
design builds on both. It adds a map, the legs between places, a stack of
ideas and, later, a travel guide made from the plan. Everything is designed
for a phone first.

## Decisions

Taken by the owner on 2026-10-18, after the first draft was challenged against
the code, the glossary and the access rules.

1. **What readers see of the plan.** One setting with three levels:
   - nothing (the default, for new and existing trips),
   - the map: countries, places and months, no nights, no notes,
   - the details: nights, notes, ideas and the guide as well.

   Anything above nothing only after a warning: readers will know where the
   owner is, and when, before and during the trip, and that cannot be taken
   back. The countdown and every other reader view follow this setting. The
   trip link never shows plan content, only published days, as today.
2. **Wikivoyage texts are taken over, not only linked.** Each text keeps the
   article and a link to the exact revision, "Wikivoyage authors" with a link
   to the history, CC BY-SA 4.0 with a link, and whether it was shortened or
   changed. That attribution appears on the idea, on the guide's sources page
   and in every export. Taken-over and edited texts stay CC BY-SA; the owner's
   own texts do not.
3. **Buddy**, as in `docs/glossary.md`, everywhere in planning too.
4. **OpenStreetMap is integrated.** It supplies coordinates, places that
   Wikivoyage often lacks (viewpoints, huts, hot springs) and ferry and rail
   lines, so the leg map shows real ways instead of straight lines. Data
   derived from OSM is kept as its own layer with OSM ids, published under the
   ODbL as a download. Maps, ideas, the guide and prints carry
   "© OpenStreetMap contributors" with a link to
   openstreetmap.org/copyright.

## Who may do what

The plan gets no new door. Access comes from the existing roles; the only new
thing is how much of the plan an invited reader sees.

| Role | Edit the plan | Map | Details | Money | Stays, private links |
| --- | --- | --- | --- | --- | --- |
| Owner | yes | yes | yes | yes | yes |
| Buddy (named in `people`) | no, not before own access (B-1664) | as an invited reader | as an invited reader | as an invited reader | never |
| Invited reader | no | at "map" or "details" | at "details" | when money for guests allows | never |
| Link reader | no | no | no | no | never |

## Screens

1. **Start.** No new tab. The upcoming-trip card gets "Continue planning",
   which opens the planner in the studio. The planner stays open during the
   trip, for the rest of the route.
2. **Route.** The existing planner with a map on top and a leg between each
   pair of stops. A leg knows both stops; a reorder sets it back to "not yet
   chosen".
3. **Leg.** Every option says where its figure comes from: a source with a
   date, the owner's own estimate, or "price unknown". Fernscout never fills
   in a price itself. The chosen option lands in money as a forecast, kept
   apart from actual spend, and replaces the previous choice.
4. **Ideas.** Yes, maybe, no — for the owner only, with undo, and the same
   ideas as a list for anyone who does not want to swipe. Ideas are their own
   stack, separate from a stop's things to see; a yes becomes a stop or a
   thing to see only when the owner plans it. Every idea carries its source
   and licence. Pictures are placeholders until a real, licensed picture
   exists.
5. **Travel guide.** Per country, what the owner already planned, as a
   readable document with a sources page. Country knowledge such as climate
   comes in only with a real source. Chapters change only the content; who
   reads it is the reader setting. Stays and private links never enter the
   guide. A printed guide would be its own product later, not the photobook.
6. **What readers see.** The setting from decision 1, next to the invited
   readers and the trip link, which still opens published days only.
7. **Reader view.** Only for invited readers, and only when the owner chose
   the map: countdown, countries and a month bar computed from the real
   dates, and following with a clear channel and unsubscribe (B-1664).
8. **Ideas for a country.** Later, a pilot with a few countries and a single
   import. Each place has a fixed source id, a date and a licence. Where
   nothing is checked the screen says "no suggestions yet"; Fernscout never
   fills a gap with invented places.

## How it fits

| Part | In Fernscout today | New |
| --- | --- | --- |
| Route | the planner: composer, stops, nights or dates, ▲▼ and drag, undo, offline | map on top, "Continue planning", open during the trip |
| Legs | none; each stop has a fixed id | `legs[]` with from and to stop ids, mode, duration, price with its basis (per person, per vehicle) and where it came from; invalid after a reorder |
| Money | `costs.items` are actual spend before the trip | forecasts kept apart, linked to the leg, replaced rather than appended |
| Ideas | things to see per stop, whose `source` only says where the coordinates came from | an ideas stack with provenance: source, article revision, authors, licence, changes |
| Readers | visibility, invites, trip link, `plan.readers` (map or details) | "nothing" as the default, a plan view for invited readers |
| Following | mail and push for new days | following before departure, with channel and unsubscribe (B-1664) |

## Order

1. **Version 1, the planner grows.** Map in the planner; legs with the owner's
   own figure or a source; forecasts apart from spend; "Continue planning",
   also during the trip. Editing by the owner only.
2. **Readers.** The countdown follows the reader setting; "nothing" as the
   default; the plan view for invited readers; following before departure.
3. **Ideas and guide.** The ideas stack with provenance; a pilot index for two
   or three countries from Wikivoyage, Wikipedia and OpenStreetMap; the guide
   as a document with a sources page.
4. **Later.** Planning together with conflict detection; suggestions from
   readers as a queue the owner accepts; more countries once upkeep is
   proven; print as its own product.

## What the review changed

The first draft was challenged against the code, the glossary and the rules
of this repository; 25 points, three of them blockers. All went in:

- Future whereabouts: the default is nothing, more only after a warning.
- The trip link grants no plan, only published days.
- Reader suggestions left version 1; later only as a queue the owner accepts.
- Who reads and what the guide holds are two separate settings.
- Version 1 stays with the owner; buddies first need their own access.
- No new tab: planning stays in the studio.
- Prices only with a source, the owner's estimate or "price unknown"; no tip
  without evidence.
- Legs know both stops, go invalid on reorder and count as forecasts.
- Provenance is its own field, not the coordinate `source` of a thing to see.
- Pictures are labelled placeholders, not presented as Wikimedia photos.
- Touch targets of at least 44 px, ▲▼ as well as dragging, undo when
  swiping, a list instead of the stack.
- Dates as "arrive 8 May · leave 12 May" rather than "8–11 May", and the
  month bar from the real dates.

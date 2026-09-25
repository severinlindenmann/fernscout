Every trip on this site can draw the road actually travelled, not just a
straight line between two days. That comes from your phone's own location
history, and this page is the exact rule this software follows for it — not
a promise, a description of the code.

## What is recorded

If you turn on **route recording** in the iPhone app, your phone logs its own
position in the background while you travel, thinned to about one point
every five minutes or 250 metres — enough to draw a road, not enough to log a
phone sitting still on a nightstand all night.

You can also **import** a location history you already have — a Google
Timeline or Takeout export, a GPX file, or your own tool's export — instead of
or alongside recording. Either way, the fixes are thinned the same way and
kept in one place: your own history, on your own journal.

## What is published

**Only a derived line, and only what a reader is currently allowed to see.**
A trip's public map never plays back your raw history — it draws
`track.json`, a line built once from your history and re-checked, on every
page load, against what that particular reader may see right now: it is cut
to the calendar dates that reader has a published entry for, and it never
draws anything from the last 24 hours, however old a day's own date claims to
be. A day you have not published yet, or a stretch of road from this
afternoon, is not on the map — for anybody, including you, reading it as a
guest would.

The two ends of every stretch of road are also cut back by 500 metres,
because that is usually a doorway, and any place you marked as private
(below) is removed and the line breaks there rather than joining across it.

## What never leaves your own folder

**Your raw location history is not published, ever, under any setting.**
There is no page, no API call and no export that hands back a single
position from it — the only thing derived from it that is ever served is the
clipped line above. If you delete your history outright, every trip you have
published keeps rendering exactly as it did the moment before: nothing on the
public side of this site depends on the raw file still being there.

## Places you mark as private

You can mark a place — your home, anywhere you'd rather never see a line
near — with an address and a radius. Every fix inside it is removed before a
line is ever drawn from your history, for any purpose, including the two
exceptions below. An unreadable list of these places is treated as "assume
everything is private" rather than "assume nothing is" — this software would
rather show you a shorter line than a wrong one.

## The two exceptions, and only two

Two screens, and only two, ever read your raw history directly, and both work
only while you are signed in to your own journal in your own browser — never
through an agent, never through a link, never through anything holding a
token:

- **Suggesting where a new day happened.** Starting a new day can offer you
  the city you were most likely in that day, worked out from your own
  history and named by an offline lookup this software runs itself — never
  sent to another company to find out. It hands back a place name, never a
  position.
- **Your own route, on your own location page.** The page where you manage
  all of this also shows you your own recording, unfiltered by the 24-hour
  or private-place rules above — because looking at your own history is not
  the thing those rules exist to protect you from.

Both are switched off unless the operator running this instance has turned
route recording on, and neither is reachable by anything acting on your
behalf rather than as you.

## Exporting or deleting it

Your raw history travels with your **own filesystem backup**, because it is
yours — but it is deliberately left out of every download this site produces
for a trip, a journal or a shared link, since none of those should ever be
able to leave with a position in them.

Deleting is real, immediate deletion, not a request that waits for anyone:
on your journal's location page, you can remove one trip's recording, one
day of it, or your whole history, monthly range or all at once. The moment
you confirm it, the fixes are gone and the affected map lines are redrawn
without them.

## Why this page exists

In September 2026, the investigative outlet Follow the Money reported that
a well-known travel-journaling app had exposed roughly 230 million photographs
and a billion location points through an API that needed no login at all —
including people's home addresses. Source:
<https://www.ftm.eu/articles/travel-app-polarsteps-military-sensitive-data-leaked>.

This page is not a comparison with that app — it is what this one actually
does with your position, in the same plain words, so you do not have to take
either claim on faith.

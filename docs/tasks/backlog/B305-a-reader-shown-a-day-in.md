---
id: B305
title: A reader shown a day in a language they did not ask for is told nothing about it
type: FEATURE
priority: low
complexity: low
area: i18n, viewer
found: "2026-09-04T15:20:03Z"
---

# B305 — A reader shown a day in a language they did not ask for is told nothing about it

## Why

B294's ticket asked for this and B294 deliberately did not build it.

`localized()` in `components/LocaleProvider.tsx` falls back to the language a
day was written in when it carries no translation for the one being read. That
is the right behaviour — a day written before B294 required every language
still reads, for everybody, rather than showing an empty page. What is missing
is the sentence: a reader who switched to English and got German prose sees no
explanation, which is the complaint that opened B294 in the first place.

Two reasons it was held back rather than guessed at, both worth keeping in
view when picking this up:

- **It is now a legacy-only path.** Since B294, a day missing a declared
  language is refused at the door. Only a day written before that, or one whose
  journal later added a language, can fall back at all. So the notice is for
  the archive, not for new writing — which changes how prominent it should be.
- **It is a wording decision in three languages**, not a mechanism. The
  mechanism is three lines; getting *"this day has not been written in English
  — you are reading the German"* to sound like an explanation rather than an
  apology, in German and Hungarian too, is the work. B289 is the standing
  warning about interpolating a language name into a Hungarian sentence.

## Work

- `localized()` already knows it fell back — it is the branch where
  `entry.translations?.[locale]` came back undefined. Return that fact
  alongside the title and content rather than making callers re-derive it.
- Show it where a day's prose is read, not on every card in a list: a feed of
  twenty cards each carrying a language notice is noise, and the reader who
  needs to know is the one reading the day.
- Three locales, and mind B289 on the Hungarian.
- Consider — do not assume — whether the trip and journal pages want the same
  treatment when a *trip's* title falls back. That has been true since
  translations existed for trips and nobody has complained, which is evidence
  it matters less there.

## Acceptance

A reader on a language a day does not carry is told, once, on the day itself,
in their own language; a reader on the language it was written in sees nothing
new.

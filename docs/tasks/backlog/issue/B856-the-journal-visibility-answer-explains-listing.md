---
id: B856
title: The journal visibility answer explains listing but not what it decides for trips
type: ISSUE
priority: low
complexity: low
area: api, journals
found: "2026-09-07T17:09:24Z"
---

# B856 — The journal visibility answer explains listing but not what it decides for trips

## Why

The journal-visibility answer explains one half of what the choice does:

> "public is listed on this server's own index, its landing page and its
> sitemap; guest is on none of them."

It does not say the other half, which `/agent.md` does say: **it is also this
journal's own answer for a new trip's default**, unless the create call
overrides it.

A tester picked `public` "because it's the word I understand, same as a public
Insta", and learned three screens later, from a different message, that it had
also decided who his future trips are open to by default.

He also did not know what a sitemap is — worth noting separately, because the
sentence explains the choice in the vocabulary of the thing being configured
rather than the consequence being chosen.

## Work

Add the trip-default half to the answer, in the API and on the form, and say
"not listed anywhere, and search engines are asked not to index it" rather than
naming the sitemap.

## Acceptance

Somebody choosing public or guest learns both things it decides, in words that
do not assume they know what a sitemap is.

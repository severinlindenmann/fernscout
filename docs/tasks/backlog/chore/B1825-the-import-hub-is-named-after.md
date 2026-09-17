---
id: B1825
title: The import hub is named after the machine's job
type: CHORE
priority: medium
complexity: medium
area: import, routes, i18n
found: "2026-09-16T19:35:11Z"
---

# B1825 — The import hub is named after the machine's job

## Why

`/[user]/extract` describes what the software does to the file, not what the
person is trying to achieve. "Import" is the word every app they have just come
from uses — Photos, Contacts, their bank — so it costs nothing to learn, and it
works as a noun in all three locales (*Import* / *Import* / *Importálás*).

Rejected alternatives and the argument for each are in
`docs/plans/2026-09-16-import-onboarding.md`. In short: *Bring in* is warmest
and matches the current heading but has no usable noun in German or Hungarian —
*Behozatal* reads as customs; *Collect* is wrong for a bank statement; *Add*
collides with adding a day or a trip.

The warmth stays in the heading, which is free to be a sentence: "What do you
want to bring in?" / "Was möchtest du mitbringen?"

**Sequence this against B1803**, which is in development on
`components/extract/*` right now. A rename landing under active feature work on
the same files is the worst of both; one of them waits.

## Work

Rename the route and everything that names it:

- 5 owner pages under `app/[user]/extract/`
- 9 API routes under `app/api/helper/[user]/extract/`
- `lib/navDestinations.ts` (`EXTRACT_DESTINATION`), `components/SiteNav.tsx`
  (icon map key, enabled gate), `lib/site.ts`
- `lib/extract/pageGate.ts` (`requireExtractOwner`)
- `components/extract/*` — fetch URLs and the `/docs/extract` link
- roughly 215 `extract.*` locale keys across `site/locales/{en,de,hu}.json`
- around 20 `test/extract-*.test.ts` files

Add redirects from every old path so bookmarks and already-sent links converge
rather than 404.

**Open decision:** whether the capability id in `lib/config.ts` /
`lib/capabilities.ts` is renamed too. Renaming it is more honest and touches
every `isEnabled("extract", …)` call site; keeping the internal id while the URL
and UI say "import" is the smaller, still-correct diff. Pick one and say which
in the ticket before starting.

No behaviour changes. Run `npm run i18n:keys` after the English keys move.

## Acceptance

- `/[user]/import` and its four sub-routes serve what `/extract` served.
- Every old path redirects rather than 404s.
- The nav entry and its active state are correct on the new path.
- `npm run i18n:keys` is clean and no `extract.*` key is orphaned.
- Verified in a real browser at desktop and phone width, old path and new.
- `npm run verify` passes.

## Revised 17 September 2026 — the target is `/studio`, not `/import`

Per `docs/plans/2026-09-17-the-studio.md`, the import hub is absorbed rather
than renamed: bringing something in is one flow among many, so the destination
is **`/[user]/studio`**, with the import flows under it.

Everything in the Work section still applies; only the destination string
changes. The naming argument for "import" over "extract" is superseded — the
hub is not only about imports any more.

**The collision with B1803 has cleared** — B1803 merged on 17 September. This
now waits on B1829 instead, since the hub it renames into has to exist.

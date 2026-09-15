---
id: B1788
title: Sign-in link page shows the literal word label on its button and renders in the browser's language, not the mail's
type: ISSUE
priority: high
complexity: low
area: Auth, sign-in link
found: "2026-09-15T08:41:26Z"
---

# B1788 — Sign-in link page shows the literal word label on its button and renders in the browser's language, not the mail's

## Why

Reported from a real standing link on the live instance,
`https://fernscout.ch/severin/s/<token>`. Two things are wrong on the one page
a reader meets before they are let in:

1. `components/SignInButton.tsx` renders the literal string `label` as the
   button's child instead of `{label}`. Every sign-in link — journal and
   identity, all three languages — shows a button that says "label". The
   `working` and `failed` props are wired correctly, so only the idle state
   is affected and no test caught it.

2. The page renders in the browser's `Accept-Language`, not the language the
   mail that carried the link was written in. Confirmed live: the same URL
   answers German chrome with `Accept-Language: de-CH…` and English chrome
   with `en-US…`, on a journal whose mail was German. `readerLocale` puts the
   device's language ahead of the journal's default (B625), which is right for
   a cold PWA install and wrong for a link that was written in a known
   language and sent to one person.

## Work

- Render `{label}` in `components/SignInButton.tsx`.
- Give `signInUrl`/`identitySignInUrl` in `lib/auth/index.ts` an optional
  locale and append `?lang=<base tag>` when it is given. `proxy.ts` already
  turns `?lang` into the locale cookie, so nothing new has to resolve a
  language — and the reader keeps that language for the rest of the visit.
- Pass the locale each mail already has at every call site: `lib/contacts/mail.ts`
  (code mail, approved mail), `app/api/auth/codes/route.ts` (identity and
  journal code mails), `lib/journals.ts` (welcome), `app/api/v2/journals/route.ts`
  and `lib/whatsapp/onboarding.ts` (relay links).
- The token is still not checked before rendering: the language comes off the
  URL, not off a lookup, so an anonymous fetch still learns nothing.

## Acceptance

- A sign-in link page shows the translated action text, not `label`.
- A link built for a German mail renders the page in German from an
  English-language browser, and the journal stays German after redemption.
- `npm run verify` passes.

---
id: B625
title: The installed PWA opens in English for a phone set to German
type: ISSUE
priority: high
complexity: low
area: PWA, i18n, language detection
found: "2026-09-06T17:51:42Z"
started: "2026-09-06T20:04:31Z"
merged: "2026-09-06T20:13:54Z"
---

# B625 — The installed PWA opens in English for a phone set to German

## Why

Reported: a phone set to German, journal locales including German, installed
the site as a PWA and it opened in English — with Magyar selected in the
picker. Somebody who reads no English is then looking at an English page with
no obvious way out.

Two things to separate before fixing: what language the *first* request picks
(`Accept-Language` against the journal's `locales`), and what the installed app
remembers. A PWA launches from the manifest's `start_url`, which carries
whatever was current when the manifest was written or when the app was
installed — so an install can pin a language the person never chose. Magyar
appearing in the picker suggests the stored preference and the rendered page
disagree, which is its own fault.

## Work

- Trace where the locale actually comes from on a cold PWA launch: the
  manifest's `start_url`, any stored preference, the cookie, and
  `Accept-Language`. Write down which one won and why.
- The person's own device language, when the journal offers it, must beat a
  default. A stored preference must be one the person actually chose.
- Fix the picker showing a language other than the one rendered — whichever way
  round that disagreement is, it is a bug on its own.

## Acceptance

- Installing the PWA from a German phone, on a journal that offers German,
  opens in German — from a cold launch, with the app closed and reopened.
- The language the picker shows is the language on the page.

## Diagnosis (2026-09-06)

**The manifest does not pin a language.** `app/manifest.ts`'s `start_url` is a
bare `"/"` — no `?lang=`, no locale segment, and the manifest is one file for
the whole instance (there is no per-user manifest). So the "install captures
whatever locale a query param carried" mechanism the Why section worried about
does not exist in this codebase; that hypothesis is ruled out.

**The real ordered list, for a journal page** (`app/[user]/layout.tsx`, via
`readerLocale`/`readerLocaleForPath` in `lib/locales.ts`):

1. The `fs.locale` cookie, honoured only if it names a language *this journal*
   offers (`user.locales`) — set by `proxy.ts` when a link carries `?lang=`,
   or by `LocaleSwitcher`'s `remember()` when the reader picks one by hand.
2. ~~`Accept-Language`~~ — **absent.** Before this fix, nothing on the main
   reading path (`app/[user]/layout.tsx`, `app/layout.tsx`, every
   `generateMetadata`) ever read the header at all. It is used today only on
   three narrow pages that have no journal yet to fall back to —
   `app/[user]/c/[token]`, `app/[user]/i/[token]`, `app/[user]/invite/redeemPage`
   — via `lib/contacts/locale.ts`'s `fromAcceptLanguage`.
3. The journal's own `defaultLocale` (`user.defaultLocale`, from
   `content/<user>/config.json`).

**This is the bug, and it needed no phone to prove**: a cold install has no
cookie yet, so step 1 never applies, step 2 didn't exist, and step 3 —
the *owner's* editorial default, not the reader's — always won. A journal can
offer German (`locales: ["de", "en"]`) while its own `defaultLocale` is
English, and every never-before-seen reader, whatever phone they carry, got
English. Confirmed with the dev server:

```
$ curl -s -H "Accept-Language: de" http://localhost:<port>/<user-with-de-in-locales-but-en-default>/gallery | grep -o '<html lang="[a-z]*"'
<html lang="en">   # before the fix
<html lang="de">   # after
```

**The picker/page disagreement was checked and ruled out as a distinct code
bug.** `LocaleSwitcher` (`components/LocaleSwitcher.tsx`) reads its checked
language and `LocaleProvider`'s dictionary (`components/LocaleProvider.tsx`)
from the exact same `locale` value that `app/[user]/layout.tsx` computes once
and passes to both — there is one source, not two, so within a single
server-rendered response they cannot name different languages. (This is the
same rule B140/B185 already put in place after an earlier version of exactly
this class of bug — the tab title and the body used to ask the question
differently.) "Magyar selected while English rendered" is therefore most
plausibly not a page that disagreed with itself, but **two different page
loads**: the reader saw a *stale* page. `public/sw.js` caches a successful
navigation response under `RUNTIME` keyed only by URL (`putRuntime`), with no
`Vary` on the `fs.locale` cookie — nothing in this codebase ever sends one
(`grep -rn "Vary"` finds only `Accept` on the media route). A cold PWA launch
does try the network first, but only for `NAV_TIMEOUT_MS` (4 seconds) before
falling back to whatever is cached (`navigationFallback`); a phone just
reopened on a weak cellular signal is exactly where that timeout is likely to
fire. If an earlier visit's response (e.g. the pre-fix English default, or a
page fetched while a different locale was picked) is what got cached, a
timed-out relaunch would serve that old snapshot — picker, content and all,
consistently in the *old* language — regardless of what the cookie says now.
That would read, a launch or two later after the reader had picked Hungarian
to see what it looked like and then changed their mind, as exactly the
symptom described. **Not reproduced** — this needs a real device on a slow
connection to confirm, which is not available here.

**Fixed**: `readerLocale()`/`readerLocaleForPath()` in `lib/locales.ts` now
take an optional `acceptLanguage` argument and rank it (with quality values,
same shape as `lib/contacts/locale.ts`'s `fromAcceptLanguage`) against the
`offered` set *before* falling back — so the order is now cookie, then
device language (if the journal offers it), then the journal's own default.
`app/[user]/layout.tsx` (the page body) and `requestLocale()` (every page
title) both now pass `headers().get("accept-language")` through, so the two
stay in agreement — same reasoning as B140/B185: one rule, not two copies of
it. Test: `test/reader-locale.test.tsx` — "no cookie: the device's own
language wins if the journal offers it" and its two neighbouring cases.

**Not fixed, and out of scope here**: `public/sw.js`'s navigation cache
still has no notion of locale, so a stale response can still, in principle,
outlive a language change on a slow connection. It no longer causes the
*reported* symptom directly (the very first cached copy will itself be in the
right language once this fix ships), but a reader who changes languages by
hand and then reopens the app on a bad connection could still be served their
previous choice for one launch. Worth its own ticket if it recurs after this
ships — making the cache locale-aware means either varying the cache key on
the cookie or having the server send `Vary: Cookie`, and either is a bigger
change than this ticket's report calls for.

**What could not be established without a real iPhone**: whether the
`start_url`/`launch_handler` combination behaves as traced above on iOS
specifically (the code path is platform-agnostic, but B430's own notes in
`app/manifest.ts` record iOS-specific storage quirks for this exact file), and
the actual "closed app, cold reopen on cellular" acceptance line — a dev
server and curl can prove the *server's* decision is now correct for a given
`Accept-Language`, not what a real installed app on a real phone, on a real
connection, ends up painting.

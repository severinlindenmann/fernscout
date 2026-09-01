# Test guide

A walk through everything that has been built, in an order that puts the
foundations first. **If a section fails, stop and say so** — later sections
build on earlier ones, and testing past a broken foundation mostly produces
noise.

Every step has a number. Report back as **"C4 doesn't work — the map is
empty"** and that is enough for me to find it.

**Legend:** ✅ what should happen · ⚠️ known limitation, not a bug ·
🔑 needs an environment variable

This is the walkthrough a person follows by hand. `docs/qa/SCENARIOS.md` is the
wider catalogue an agent runs end to end — API, MCP, auth, mail and two
journals on one instance — and `docs/qa/BLACKBOX.md` is the pass run by testers
who have never seen the source.

---

## A — Does it run at all

Nothing else matters until this passes.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **A1** | `npm install` | Finishes, no errors |
| **A2** | `npm run dev`, open http://localhost:3000 | The **landing page** — what this is, how to hand it to an agent, and the public journals on this server |
| **A3** | `npm test` | Every test passes |
| **A4** | Click a journal card at the bottom of the landing page | Opens that journal, e.g. `/example` |
| **A5** | `npm run build` | Compiles, no errors |
| **A6** | `npm run build && npm start`, open http://localhost:3000 | Same as A2. **Test the rest against this**, not `dev` — some bugs only appear in a production build |

---

## B — Reading a journal

The core. No configuration, no accounts.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **B1** | Look at `/example` | The current trip (**Across and back**, USA) opens on an overview: map, headline numbers, spend |
| **B2** | Press **Continue** / the arrow keys | Moves day by day, animating between stops |
| **B3** | Scroll to the bottom of a day | The next day follows; the address bar shows `#day-…` |
| **B4** | Copy a `#day-…` URL, open it in a new tab | Opens on that day, not the top |
| **B5** | Click the trip name in the header | The trip switcher lists all five journeys, grouped **now / upcoming / past** |
| **B6** | Open **Four days round the Alps** | A short past trip, four days |
| **B7** | Open **Five months east** | A long past trip, five days spread over five months |
| **B8** | Open **Eighteen days, eleven parks** | A past road trip: 18 days, 18 different places, one night each |
| **B9** | On that trip's overview | The heading is the **trip's** name, and the badge reads "The last stop was Denver" — past tense, no pulsing dot |
| **B10** | Press **Continue** twenty times on it | Every day loads. Nothing sticks on "Fetching this day…" |
| **B11** | `/example/trips` | All **five** trips, grouped current / upcoming / past. The four that have happened each show a cover photo and a day, country and photo count that are **not 0** |
| **B12** | The lifetime map on that page | Four drawn routes, each a different colour in the legend |
| **B13** | Try a URL that does not exist, e.g. `/example/day/nonsense` | A real "not found" page in the site's design, not a stack trace |
| **B14** | Try `/nobody` | "There is no journal at this address" |
| **B15** | Open **Japan, end to end** | A trip that has not happened: a days-away countdown, the planned route on a map, the planned budget — and "no days written yet". No story, no gallery |
| **B16** | On that page, hover/tap a planned stop | Each carries a short `note:` from `plan.md` ("Fly home from here") |

---

## C — What is on a day

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **C1** | Any day with photos | Photos in a grid, mixed portrait/landscape/square, none stretched |
| **C2** | Click a photo | Full-screen viewer, arrow keys move, Escape closes |
| **C3** | **Five months east** → **Two days on the Mekong** | A **ten-second video** among the photos. It should play |
| **C4** | `/example/map` | World map with the route drawn, stops marked, coloured by transport |
| **C5** | `/example/trips/parks-2025/map` | 18 stops, clustered into numbered circles when zoomed out. Every entry in the stop list below opens that day |
| **C6** | `/example/gallery` | Every photo from the trip, filterable by place |
| **C7** | `/example/costs` | Charts: spend by category, by country, against budget |
| **C8** | On `/example/costs`, check the total | Should be a sensible number, not `NaN` or `0` |
| **C9** | `/example/search`, search for `truck` | Finds "Denver, and a truck" and links to it |
| **C10** | Search for `lantern` on the Asia trip | Finds the Hoi An day |
| **C11** | Click a reaction (heart, etc.) on any day | It registers and survives a page reload |
| **C12** | **Across and back** → 24 August | The day holds **two updates**, at 13:20 and 21:40, in that order. The header reads "2 updates" |
| **C13** | The Mekong video in the grid, with the network tab open | The thumbnail is `clip.jpg`. The `.mp4` is only fetched once you play it |

---

## D — Money

The five trips deliberately spend in **CHF, EUR, THB, VND, USD and JPY**.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **D1** | `/example/costs` on **Five months east** | Thai baht and Vietnamese dong shown converted to CHF |
| **D2** | The currency chip in the header → **EUR** | Every number on the page changes, marked `≈` |
| **D3** | Switch to **USD**, reload the page | Still USD — the choice sticks |
| **D4** | Compare the Alps trip and the USA trip | Each converts at its own rate; they are different trips in different years |
| **D5** | Look for anything reading `NaN`, `undefined`, or a suspiciously round `0` | There should be none |

---

## E — Languages

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **E1** | The language chip → **Deutsch** | Menus, buttons and dates in German |
| **E2** | Reload | Still German — the server remembers, not just the browser |
| **E3** | Open `/example?lang=hu` in a **private window** | Hungarian **on the first load**, no English flash |
| **E4** | Click through to another page, no `?lang=` | Still Hungarian |
| **E5** | On the Asia trip, days **First morning in Bangkok** and **Two days on the Mekong** in German | The diary text itself is German, not just the menus |
| **E6** | The same days in Hungarian | Bangkok is Hungarian; ⚠️ the others fall back to English text — only some days are translated, on purpose |
| **E7** | `/example?lang=englishplease` | Ignored, falls back to the journal's own language |
| **E8** | `/sitemap.xml`, search for `hreflang` | Every page listed in each language |

---

## F — Privacy

This is where a mistake would be expensive, so test it properly.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **F1** | `npm run trip:password -- "familie2026"` | Prints a `scrypt$…` hash |
| **F2** | Paste it into `content/example/trips/alps-2024/trip.md` as `passwordHash:`, and add `visibility: password`. 🔑 Set `SESSION_SECRET=$(openssl rand -hex 32)`. Rebuild | — |
| **F3** | Open `/example/trips/alps-2024` | A password form, **not** the trip |
| **F4** | Enter a wrong password | Refused, with a message that says what to do |
| **F5** | Enter `familie2026` | The trip opens |
| **F6** | Reload, and open another page of that trip | Still open — you are not asked again |
| **F7** | In a **private window**, open one of that trip's photos directly, e.g. `/example/media/alps-2024/over-the-susten/01.jpg` | **404.** A private trip's photos must not be fetchable by URL |
| **F8** | In that private window, check `/sitemap.xml` and `/example/feed.xml` | The Alps trip appears in **neither** |
| **F9** | `/example` and `/example/trips` in the private window | Still work. **A private trip must not hide the rest of the journal** |
| **F10** | Set `visibility: unlisted` instead. Rebuild | Reachable by link, but absent from the sitemap and the trip switcher |
| **F11** | Set `costsVisibility: guests` on a public trip | The costs page hides the numbers |
| **F12** | Undo F2–F11 before continuing | — |

---

## G — Writing through an agent

The headline feature: **there is no editing UI.** 🔑 Needs:

```bash
export DATABASE_URL="sqlite:$PWD/.data/test.db"
export SESSION_SECRET=$(openssl rand -hex 32)
export AUTH_DEV_CODE=123456          # so no real email is needed
```

and in `content/config.json` set `features.auth.enabled` and
`features.mail.enabled` to `true`. Then `npm run db:migrate`, rebuild, start.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **G1** | Open `/documentation.txt` | A readable document naming the journal and how to write to it |
| **G2** | Open `/agent.md` | The full guide: authenticate, read, write, with examples |
| **G3** | Open `/openapi.json` | A machine-readable API description, not a 404 |
| **G4** | Open `/example/day/denver-and-a-truck.md` | The **markdown source** of that day, not the rendered page |
| **G5** | `curl -X POST localhost:3000/api/auth/request -H 'content-type: application/json' -d '{"user":"example","email":"agent@fernscout.ch","kind":"agent"}'` | `202`, and an `.eml` file appears in `content/example/mail/` |
| **G6** | `curl -X POST localhost:3000/api/auth/verify -H 'content-type: application/json' -d '{"user":"example","email":"agent@fernscout.ch","code":"123456","kind":"agent"}'` | A token starting `fs_agent_` |
| **G7** | Same request with a **different** email | `202` but **no** mail written — only the owner can get a write token |
| **G8** | `curl localhost:3000/api/v1/example/trips -H "authorization: Bearer <token>"` | All four trips as JSON |
| **G9** | POST a new day (the exact call is in `/agent.md`) | `201`, and it says **draft** |
| **G10** | Look for that day on the site | **Not there.** Drafts are invisible until a person publishes |
| **G11** | `curl localhost:3000/api/v1/example/drafts -H "authorization: Bearer <token>"` | Your draft, waiting |
| **G12** | Delete the `status: draft` line from the new entry file, rebuild | Now it appears on the site |
| **G13** | Repeat G9 with the same title and date | `409` — a retry must never overwrite the first attempt |
| **G14** | **The real test:** give a fresh Claude/ChatGPT the URL `http://localhost:3000/documentation.txt` and your email, and ask it to write up a day | It should manage without further help |

---

## H — Email

Same environment as G. Mail is written to `content/example/mail/` as `.eml`
files you can open — no mail account needed.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **H1** | Set `features.contacts.enabled: true` and 🔑 `CONTACTS_ENCRYPTION_KEY=$(openssl rand -hex 32)`. Rebuild | — |
| **H2** | Open `/example/join` | A short form: name, email, optional postal address |
| **H3** | Fill it in and submit | A code arrives as an `.eml`; entering it confirms you |
| **H4** | Check `content/example/mail/` | A "someone wants to follow" mail addressed to the owner |
| **H5** | Open `/example/contacts` (as owner) | The pending request, with an approve button |
| **H6** | `npm run digest -- --user example --dry-run` | Lists who would get what, sends nothing |
| **H7** | `npm run digest -- --user example` | A digest `.eml` per approved contact |
| **H8** | Open one in a mail client | Readable, large type, links work, has an unsubscribe link |
| **H9** | Add a contact with German as their language, run the digest again | Their mail is in German |
| **H10** | Run the digest twice in a row | The second run sends **nothing** |

---

## I — Print

Both stop before anything is actually ordered.

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **I1** | `npm run photobook -- --trip example/asia-2023` | PDFs in `content/example/photobooks/` |
| **I2** | Open the interior PDF | A real book: cover, route, chapters, photo pages, costs |
| **I3** | Check `…-pdfx.txt` | Honest report — it is RGB, **not** PDF/X. ⚠️ Expected; three of four printers accept RGB |
| **I4** | Create `recipients.json` (see `docs/providers/postcards.md`), then `npm run postcard -- --user example --photo <a jpg> --message "Hello" --to recipients.json` | Print-ready postcard PDFs |
| **I5** | Open one | Photo on the front, message and address correctly placed on the back |
| **I6** | `npm run postcard -- --providers` | Says which need an account. ⚠️ Nothing is ever sent |

---

## J — Everything else

| # | Do this | ✅ Expect |
| --- | --- | --- |
| **J1** | `/example/feed.xml` | Valid RSS of the public days |
| **J2** | `/example/export.zip` | A zip of markdown and photos that could rebuild the journal |
| **J3** | `npm run export -- example` | The same, from the command line |
| **J4** | `/api/health` | Every feature listed with on/off and **why** |
| **J5** | `npm run ingest -- --user example --trip usa-2026 <a folder of photos>` | Reads EXIF, resizes, writes a dated entry |
| **J6** | `exiftool` a resized photo it produced | **No GPS.** Coordinates go in the text, not the file |
| **J7** | The whole site on a phone (or a 390px window) | Nothing scrolls sideways; buttons are thumb-sized |
| **J8** | Tab through a page with the keyboard | A visible focus ring everywhere |
| **J9** | `/welcome` | Redirects to `/` — the landing page moved to the root |
| **J10** | The landing page with `?lang=de` and `?lang=hu` | Fully translated, including "Entdecke öffentliche Reisen unserer Mitglieder" |

---

## Known gaps — do not report these

- **Push notifications** need HTTPS and a real phone; untestable locally.
- **The service worker does not run under `npm run dev`**, by design — it
  would serve the previous build's assets to a dev server that has since
  recompiled. Offline behaviour is tested against `npm run build && npm start`.
- **SMTP** is not implemented. Mail only writes files, by design.
- **The photobook is RGB, not PDF/X.** Documented, with the Ghostscript fix.
- **No restore drill has been run** on the native (non-Docker) deployment.
- **Nothing is deployed.** No domain, no server.

---

## Reporting back

Just the number and what you saw:

> **C4 doesn't work** — the map is empty on the USA trip
> **G9** — got a 500 instead of a 201

Worth flagging separately: anything that reads as **wrong rather than broken** —
clumsy wording, a number that looks off, a page that works but feels awkward.
Those are the ones I cannot find by testing.

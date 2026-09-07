## Who runs this

Fernscout™ is run as a **hobby project** by Severin Lindenmann, Switzerland.
It is not a company, there is no support desk, and there is no service level
agreement behind it.

Contact: <agent@fernscout.ch>

The source code is public and can be read in full at
[github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).
It is licensed under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0):
free to run, modify and self-host, for as long as you like, with one
restriction — it may not be used to provide a product that competes with
Fernscout. That restriction means it is **source-available rather than open
source**, since the Open Source Definition does not permit it, and this site
does not use the term.

## What is not promised

This site is offered as it is, without warranty of any kind.

**No responsibility is accepted for lost data.** Journals are backed up, but a
backup can fail and a restore can be incomplete. If a trip matters to you,
keep your own copy — every journal exports as the markdown and photographs it
already is, and asking your agent for an export is the way to get one.

**No responsibility is accepted for a data breach.** The software is written
with security taken seriously — credentials are hashed, tokens expire, private
trips are refused rather than merely hidden, and the code is reviewed for it —
but no system is proof against every attack. Do not put anything on this site
whose disclosure you could not live with.

By using this site you accept that any liability, to the extent the law
permits it, is excluded.

## Where the data is

Everything is on a single virtual server rented from **Hetzner Online GmbH**,
in a **German data centre**. Nothing is replicated to another country, and
there is no cloud storage account, no CDN and no third-party database behind
it. Backups stay on European infrastructure.

## Tracking, and what little there is of it

There is **no third-party analytics** on this site. No Google Analytics, no
Plausible, no Matomo, no pixels, no advertising network, no third-party fonts
or scripts. Nothing on these pages is loaded from anybody else's server, and
nothing on these pages reports your visit to anybody but this one.

A journal's author may switch on a **visitor count** for their own journal. It
is off unless they have. When it is on, this server records that a page was
opened — which journal, which trip, which day, and the time — so that somebody
writing a travel diary can tell whether the people they sent it to have read
it.

**You are not identified, and you cannot be followed.** There is no cookie for
this, no script in your browser, and no device fingerprint. To tell two readers
apart on the same day, the server makes a short code out of your internet
address and your browser's name, mixed with a secret that is generated at
random, kept only in memory, and thrown away every day. Your IP address itself
is never written down. Once the day's secret is gone the codes cannot be traced
back to anybody, and they cannot be matched against the next day's — so the
same person visiting tomorrow is counted as somebody new, and there is
deliberately no way to build a picture of one reader over time.

What is **not** recorded: your IP address, your browser, your operating system,
your country or city, and the page you came from. Some of those are ordinary in
web analytics; the last one is left out on purpose, because it would record
where a private link had been passed around.

These rows are deleted after about ninety days.

Cookies are only ever set for signing in — a session, or an identity that
proves your email address to the site. There is still no cookie banner: nothing
described above is stored on your device or read from it, so there is nothing to
consent to.

The web server also keeps ordinary access logs (IP address, time, page
requested) for a short period, which is what a server needs in order to be
operated and defended at all.

## What is stored, and why

- **Journal content** — the text, photographs and dates their authors write.
- **Email addresses** — of a journal's owner, of the people on a trip, and of
  readers who were invited. An address is the credential here: there are no
  passwords, so sign-in works by sending a code to an address.
- **Sessions and agent tokens** — so a browser stays signed in and an agent
  can write for seven days. Visible to their owner, and revocable at any time.
- **Push subscriptions**, if you asked a journal to notify your device.
- **Phone numbers and postal addresses**, only for readers who gave one in
  order to receive a WhatsApp message or a printed postcard. Postal addresses
  are stored encrypted and are never shown to an agent.
- **Copies of the mail this site sends**, kept with the journal that sent it.
- **Page-open counts**, for journals whose author switched the visitor count
  on: which page, when, and the day-code described above. Nothing that names
  a reader, and deleted after about ninety days.

You can ask the owner of a journal to remove you from it, and an owner can
delete a whole journal — that deletion is real, and it takes the content and
the rows with it.

## External services

Everything below is **off unless a journal switched it on**, and is only ever
used for what it says. Nothing is passed to any of them for analysis,
advertising or profiling.

| Service | When it is used | What it receives |
| --- | --- | --- |
| **Meta Platforms Ireland** (WhatsApp Cloud API) | A reader asked to hear about new days by WhatsApp | Their phone number, and the message |
| **Stannp Ltd** (United Kingdom) | Somebody ordered a printed postcard | The photograph, the message and the recipient's postal address |
| **Gelato ASA** (Norway) | Somebody ordered a printed photobook | The book's PDF and the delivery address |
| **Proton AG** (Switzerland) | Sign-in codes, invitations, notifications | The recipient's address and the message |
| **Anthropic PBC** (United States) | Somebody used the writing helper at `/agent` — to have a day written up, to have photographs captioned, or to have one typed sentence understood | What they typed or said; the facts their own day already carries (its date, place, country, and how many photographs are on it and between which times); and, for captions, the photographs themselves |
| **Deepgram Inc.** (United States) | Somebody spoke to the helper at `/agent` instead of typing | The recording of their voice, and the language it is in |
| **Open-Meteo** (Germany) | A journal asked what the weather was on a day it recorded | The coordinates and the date of that day — nothing about you |
| **European Central Bank** (Germany) | A trip needed the exchange rate for a currency it spent in | Nothing at all — the request is for a published document and carries no question |

That is the whole list. There is nobody else.

**Those two rows carry a condition the others do not, and it is worth stating
plainly: nothing reaches Anthropic or Deepgram unless somebody uses the writing
helper at `/agent`.** Reading a journal never does. Writing one through your own
agent never does. An author who types their own days never causes a
single request to either company, and a reader cannot cause one at all.

What is sent is what the person put in front of the helper, and the few facts
their own day already carries — the ones already on their screen while they use
it. **No location history, no contacts, no email addresses and no postal
addresses are sent to either, ever.** A journal's position history, where it
keeps one, is held in a folder no request of any kind can reach, and it is not
among the facts the helper is given.

**The voice recording is never stored.** It arrives in one request, goes to the
transcription provider, and is dropped when the request ends — no copy is
written to this server, to a backup or to a journal's own export. What is kept
is the text, because the text is what the person asked for. An instance that
has not configured a transcription provider does not send the audio anywhere at
all — nothing leaves the machine, and no company hears it.

Both are used only for the one request that was asked for. Neither is sent
anything for analysis, advertising or profiling, and neither is asked to hold
anything after it has answered.

The weather row is different from every row above it and the difference is
worth stating plainly: **that request is made by this server, not by your
browser.** It is sent once, when a day is written, and what comes back is
stored in that day's own file — so reading a page that shows the weather
sends nothing to anybody. Open-Meteo never sees your address, and no request
carries anything that identifies a person. The coordinates are the ones the
journal's author put on their own day.

Weather data by [Open-Meteo.com](https://open-meteo.com/), used under the
[Creative Commons Attribution 4.0 licence](https://creativecommons.org/licenses/by/4.0/).
That licence asks for three things and this is all of them: credit, a link to
the licence, and a note of any changes made. **The changes are that readings
are rounded** — temperatures to whole degrees and rainfall to one decimal
place, as shown on a day — and that Open-Meteo's numeric weather code is drawn
as one of seven pictures rather than printed. The unrounded values stay in the
day's own file.

Open-Meteo is itself a front end onto the national weather services —
MeteoSwiss, the DWD, ECMWF, NOAA, Météo-France, the JMA and others, each under
its own open licence, all listed on
[their licence page](https://open-meteo.com/en/licence). So a day's weather
here traces back to a public meteorological office, not to a company that
sells forecasts.

**A reading a traveller recorded themselves is none of the above.** Some days
carry a temperature somebody wrote down where they were standing, rather than
one this server looked up. Those name whoever took them and are credited to
nobody else — there is no Open-Meteo link on such a day, because there is no
Open-Meteo data on it.

**Money is the same shape as the weather, and the last row receives even
less.** A trip records what was spent in the currency it was spent in, and to
show that in anybody else's currency it needs a rate. Those come from the
European Central Bank's published euro reference rates: the daily table that
converts a total into the currency you picked at the top of a costs page, and
— for the rate a trip is permanently costed at — the ECB's 90-day history,
read once for the day a currency first appears on that trip and then frozen
into the trip's own file. **Both requests are made by this server, and both
ask for a whole public document.** The ECB is not told which trip, which
currency or which date is of interest, and your browser never talks to it at
all.

Exchange rates from the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html),
whose reference rates may be reproduced with the source acknowledged, which is
what this paragraph and the citation on the costs page are. **The change made
is that the ECB quotes every currency against the euro and a journal does
not** — so a rate here has been cross-divided into the journal's own base
currency, and rounded to six figures. A costs page that used a looked-up rate
names the ECB and the date it used, beneath the totals.

**A rate somebody typed in themselves is none of the above** and carries no
citation, because there is nothing to cite but the person who wrote it — the
rate a card statement actually charged, say, which no reference rate knows.
Where a currency has no rate at all, the spend is shown as it was paid and
left out of the totals rather than converted at a number nobody can stand
behind.

The mail this site sends goes through **Proton Mail in Switzerland** —
encrypted at rest and under Swiss privacy law, rather than through a provider
that reads mail to sell against it. Once a message leaves for an address that
is not itself on Proton it is ordinary email, which is worth knowing before
anybody puts something sensitive in a reply.

## Your rights

Under the GDPR and the Swiss FADP you may ask what is stored about you, ask
for it to be corrected, and ask for it to be deleted. Write to the address at
the top of this page. There is one person reading it, so please be patient.

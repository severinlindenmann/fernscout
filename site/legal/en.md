---
updated: 2026-09-25
summary:
  - A hobby project run by one person in [Country], not a company.
  - Everything lives on one server in Helsinki, Finland, with a second encrypted backup in Germany.
  - No tracking, no advertising, no third-party scripts. Cookies only to keep you signed in and remember your choices.
  - Outside services are used only for the feature that needs them, and only when somebody uses it.
  - The AI helper sees only what you choose to give it, and only after you said yes.
  - You can export or delete a journal at any time, and ask what is stored about you.
---

<!-- This file is the repository's TEMPLATE, shipped to every clone. This
     instance's real imprint lives outside the checkout — see lib/legal.ts
     and docs/running-locally.md for where to put a real legal/<locale>.md
     that overrides this one without ever being committed.

     `updated:` is the date somebody last read this page against what the
     software does. Change it when you do that, not when you fix a typo.
     A `{#id}` after a heading fixes that section's link; keep them the same
     in every language — /legal#privacy is the App Store's privacy URL. -->

## Who runs this {#operator}

Fernscout™ is run as a **hobby project** by [Operator name], [Country].
It is not a company, there is no support desk, and there is no service level
agreement behind it.

[Operator name], [Street and number], [Postcode and town], [Country]

Contact: <[contact email]>

**Who is responsible for what.** [Operator name] is responsible for running
this site: accounts and sign-in, the server and its logs, payments, and the
services listed below. What goes into a journal — its words, photographs and
the people on it — is decided by that journal's owner, who also decides who may
read it. For that content this site works on the owner's behalf: it stores it,
shows it to the people the owner allowed, and sends it where the owner asked.

The source code is public and can be read in full at
[github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).
It is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0):
free to run, modify, self-host and redistribute, for as long as you like,
with no restriction on competing with it. The Fernscout name and logo are
not part of that licence — see the project's `TRADEMARK.md`.

## What is stored, and why {#privacy}

The legal bases named here are the GDPR's, for readers in the EU. Swiss law
asks for the same information without them.

| What | Why | Basis | How long |
| --- | --- | --- | --- |
| **Journal content** — text, photographs, dates, costs, the people on a trip | It is the journal | Contract with the owner | Until the owner deletes it |
| **Email addresses** — of owners, of people on a trip, of invited readers | An address is the credential here: there are no passwords, sign-in sends a code | Contract | As long as the account or invitation exists |
| **Sessions and tokens** — with the name of the browser that signed in, never its IP address | So a browser stays signed in, and an agent can write | Contract | A reader's session a year, an agent's token seven days; revocable at any time |
| **Readers and contacts** — names, email addresses, phone numbers, postal addresses, and the owner's own notes on them | So an owner can send a day, a postcard or an invitation to the people they chose | The owner's legitimate interest | Until the owner removes them. Phone numbers and postal addresses are stored encrypted and are never shown to an agent |
| **Reactions** — which emoji was left on a day, under a random code your browser keeps | So a reader can react once and take it back | Legitimate interest | As long as the journal |
| **Conversations with the helper**, and messages, photographs, documents and voice-note transcripts sent by WhatsApp or text message | So an owner can carry on where they left off | Contract | Until the owner deletes them or the journal |
| **Location history** | So a trip's map shows the roads really travelled | Consent, per trip | Until the owner deletes it, by month or all at once |
| **Page-open counts**, for journals whose author switched them on | So an author can tell whether their readers read | Legitimate interest | About ninety days |
| **Request log** — the page asked for, the time, the browser's name; no IP address | To run and defend the server | Legitimate interest | 14 days |
| **Copies of mail this site sent** | To see why a sign-in code did not arrive | Legitimate interest | Two days, never backed up |
| **iPhone app waitlist** — an email address, and the language you asked for | So we can tell you once the app is on the App Store | Consent | Until the app is released, or you ask us to remove it |
| **Payments, credits and print orders** | Bookkeeping | Contract, and the law (Swiss bookkeeping rules) | Ten years; see [Deleting](#deleting) |
| **Encrypted backups** of all of the above | So a broken disk does not end a journal | Legitimate interest | 14 days on the server, 7 days in the second copy |

**Only the owner of a journal talks to the helper** — on the web because
signing in requires it, and over WhatsApp because only a phone number the owner has already proven is ever bound to a journal. A
message from any other number gets one fixed reply declining to help and a
link to sign in, and never reaches the model. **We read helper conversations
to see what to improve, and an owner can turn that off** on their own page, at
any time. Turning it off deletes nothing; it means nobody but them reads what
is there or what comes next.

**Location history** is only there for a journal whose owner put it there: a
file they imported (a Google or GPX export), or positions the iPhone app
recorded during a trip they switched recording on for. It goes only to this
journal's own server. Readers never see it: a trip's map shows a line drawn
from it only for days they may already read, nothing from the last 24 hours,
never the first or last 500 metres of a stretch, and nothing near places the
owner marked private. The owner alone can be offered the name of the town a
day was spent in, worked out on this server without asking anybody.

**Only send what you have the right to share.** A photograph with somebody
else in it, or a document with somebody else's name on it, was never asked for
their consent, and neither this page nor the software can give it on their
behalf.

Giving an email address is needed to sign in. Everything else is optional,
and each feature says what it needs when you use it.

## On your device {#device}

There is no cookie banner, because nothing stored on your device is there to
follow you: each item below is either needed for what you asked the site to
do, or remembers a choice you made.

| Name | Kind | What it does | How long |
| --- | --- | --- | --- |
| `fs_session` | Cookie | Keeps you signed in to a journal | A year |
| `fs_identity` | Cookie | Remembers that you proved your email address, so you need not prove it again on every journal | A year |
| `fs.locale` | Cookie | The language you picked | A year |
| `fs.journal` | Cookie | Which journal a welcome link was for | A year |
| Theme, currency, speech language, dismissed notices | Browser storage | Choices you made on this device | Until you clear them |
| A reaction code | Browser storage | A random code, so the emoji you left can be taken back | Until you clear it |
| A push token | Browser storage | So this device can stop notifications it asked for | Until you clear it |
| Offline copies | Browser cache | Pages you read, and whole trips you saved to read offline | Until you clear them or remove the trip |

**There is no third-party analytics.** No Google Analytics, no Plausible, no
Matomo, no pixels, no advertising network, no third-party fonts or scripts.
Nothing on these pages is loaded from anybody else's server.

**The visitor count does not identify you.** A journal's author may switch on
a count for their own journal. It uses no cookie and no script. To tell two
readers apart on the same day, the server makes a short code out of your
internet address and your browser's name, mixed with a secret that is
generated at random, kept only in memory, and thrown away every day. Your IP
address itself is never written down, and the same person visiting tomorrow
is counted as somebody new. The page you came from is deliberately not
recorded, because it would show where a private link had been passed around.

## Where the data goes {#recipients}

Everything is on one virtual server rented from **Hetzner Online GmbH**, in
its data centre in **Helsinki, Finland**. Encrypted backups are kept on that
server and in **Hetzner Object Storage in Falkenstein, Germany**. There is no
CDN and no third-party database.

The services below are used only for what the row says, and only when
somebody uses that feature. Nothing is passed to any of them for analysis,
advertising or profiling.

| Service | Where | Used when | What it receives |
| --- | --- | --- | --- |
| **Proton AG** | Switzerland | Sign-in codes, invitations, notifications by email | The recipient's address and the message |
| **Twilio Inc.** | United States | Somebody chose to get a code or a notification by text message, or texted the journal | The phone number and the text of the message |
| **Meta Platforms Ireland** (WhatsApp) | Ireland, and the United States | A reader asked to hear about new days by WhatsApp, or an owner's own proven number messages the journal | The phone number and the message, photograph, document or voice note |
| **Apple** (push notifications) | United States | A device running the iPhone app asked to be notified | A device token, and the notification's title and link |
| Your browser's push service (Google, Mozilla or Apple) | Depends on the browser | A browser asked to be notified | An encrypted message it cannot read, and a device address |
| **Anthropic PBC** | United States | The owner used the helper, after saying yes to it — see [AI and voice](#ai) | What the owner gave it for that one request |
| **Deepgram Inc.** | United States | The owner spoke to the helper, or sent a voice note | The recording, and its language |
| **Stripe** | Ireland, and the United States | Somebody bought credits | The amount, the email address for the receipt, and the journal's name as a reference. Card or TWINT details are typed on Stripe's own page, never on this one |
| **Stannp Ltd** | United Kingdom | Somebody sent a printed postcard | The postcard's picture and message, and the recipient's name and postal address |
| **Gelato ASA** | Norway | Somebody ordered a printed photobook | The book, and the recipient's name, postal address and email address |
| **Amazon Web Services** (open elevation data) | United States | A photobook with a relief map was made | Which map tiles are needed, which shows roughly where the trip went — nothing about a person |
| **Komoot GmbH** (Photon place search) | Germany | Somebody typed an address or a place to look up, or shared a location | The words typed, or the coordinates. The request comes from this server, not your browser |
| **Open-Meteo** | Germany | A journal asked what the weather was on a day | The coordinates and date of that day. From this server |
| **European Central Bank** | Germany | A trip needed an exchange rate | Nothing: the request is for a whole published document |

**Transfers outside Switzerland and the EU.** Finland, Germany, Ireland and
Norway are covered by the EU's data protection rules, and the United Kingdom
by an adequacy decision. For the services in the United States, the transfer
rests on each provider's standard data processing terms, accepted when the
account was set up rather than negotiated: for Meta and Anthropic the
**Swiss–US Data Privacy Framework**; for Meta also its **Business Data
Processing Terms** and **Business Data Transfer Addendum**; for Anthropic its
**commercial terms**, which carry a data processing agreement. Deepgram's data
processing terms are not click-through in the same way, and whether one is in
place for this instance is stated honestly: it is not, pending a request
already sent to Deepgram's own privacy contact.

**Meta plays two roles.** For the message content you send, Meta acts on this
journal's instructions and states that those messages are not used to target
advertising. Separately, and on its own account, Meta keeps WhatsApp account
data for platform safety and fraud detection; that is Meta's relationship with
you as a WhatsApp user, described in
[WhatsApp's own privacy policy](https://www.whatsapp.com/legal/privacy-policy).

**What Stripe does with payment data** is covered by
[Stripe's privacy policy](https://stripe.com/privacy).

**A link out is not a service on that list.** Under a trip's map, and in some
emails, there is "Open in Google Maps". It is an ordinary link carrying the
coordinates of one place. Until somebody clicks it, nothing goes to Google.
Click it and you are on Google's site, where
[Google's privacy policy](https://policies.google.com/privacy) applies and this
operator has neither control nor sight.

## AI and voice {#ai}

The helper can write up a day, caption photographs, read a bank statement
into a trip's costs, turn a photograph of travellers into drawn figures, and
understand a spoken sentence. **Each of those is asked for separately**, in
the app, before anything is sent: your words, your photographs, your voice,
your bank statements. The question names the company it would go to. You can
take a yes back at any time on the same page, and nothing is sent after that.

| You said yes to | Sent to | What is sent |
| --- | --- | --- |
| Your words | Anthropic | What you typed or said, and the facts your own day already carries: its date, place, country, and how many photographs are on it and between which times |
| Your photographs | Anthropic | The photographs you asked it to caption, or to turn into figures — which may show people |
| Your bank statements | Anthropic | The header row and five sample rows, so it can tell which column is which. Never the whole file |
| Your voice | Deepgram | The recording, and the language it is in |

**Nothing reaches either company unless the owner uses the helper.** Reading a
journal never does. A reader cannot cause a request, and nor can a stranger
who messages the journal's WhatsApp number. **No location history, no contacts
and no addresses are ever sent** to either.

**The voice recording is never stored.** It goes to the transcription service
in one request and is dropped when the request ends; no copy is written to
this server, to a backup or to an export. The text is kept, because the text is
what was asked for. Both services are used only for the one request, and
neither is asked to keep anything or to train on it.

## The iPhone app {#iphone}

The app shows this same site, so everything above applies to it. What it adds:

- **Photographs.** The app reads only the photographs you pick, and uploads
  them with their originals to your own journal.
- **Location, only for a trip you switched recording on for.** iOS asks for
  "Always" access, and a message on the phone names the server and journal
  before recording starts. Positions go only to your own journal. Recording
  stops by itself the day after the trip ends, unless you chose to keep it
  running, and you can stop it at any time on the trip's page.
- **The microphone**, only while you are recording something to tell the
  helper, and only after you allowed it. The recording goes to the
  transcription service as described in [AI and voice](#ai) and is never
  stored.
- **Notifications**, only if you allow them, delivered through Apple.
- **Sharing into Fernscout** from another app uses a sign-in kept in the
  phone's Keychain, valid for seven days.

**Everything works if you say no.** Without location, a trip's map has no
recorded route; without the microphone, you type instead of speaking; without
notifications, you get none. There is no tracking, no
advertising identifier and no third-party analytics in the app.

## Deleting {#deleting}

**An owner can delete a trip, or a whole journal.** Asking sends a
confirmation email; nothing is removed until the link in it is followed. Then
the content, the photographs, the readers and every row that belonged to the
journal are deleted. A short note stays behind so the address can say the
journal is gone rather than that it never existed. Copies in the backups
expire within 14 days.

**Payment records are kept.** Swiss bookkeeping rules require them for ten
years: what was bought, for how much, when, and the payment provider's
reference. Names, email and postal addresses are removed from them when the
journal is deleted. Stripe keeps its own record of the payment.

**An owner can download everything** as a zip of the journal's files and
photographs from their own page, at any time.

**A reader** can ask the owner of a journal to remove them, or write to the
address at the top of this page.

## Your rights {#rights}

You may ask what is stored about you, and have it corrected, deleted or handed
to you in a format you can take elsewhere. You may object to anything done on
the basis of legitimate interest, and withdraw a consent at any time without
affecting what was done before. No decision about you is made automatically.
Write to the address at the top of this page. There is one person reading it,
so please be patient; you will get an answer within thirty days.

You can also complain to the **Swiss Federal Data Protection and Information
Commissioner** ([edoeb.admin.ch](https://www.edoeb.admin.ch)) or, in the EU,
to the data protection authority where you live.

## Weather and exchange rates {#sources}

**The weather is looked up by this server, not by your browser.** It is asked
once, when a day is written, and stored in that day's own file, so reading a
page that shows the weather sends nothing to anybody.

Weather data by [Open-Meteo.com](https://open-meteo.com/), used under the
[Creative Commons Attribution 4.0 licence](https://creativecommons.org/licenses/by/4.0/).
The changes made: temperatures are shown in whole degrees and rainfall to one
decimal place, and Open-Meteo's weather code is drawn as one of seven pictures
rather than printed. Open-Meteo is itself a front end onto the national
weather services — MeteoSwiss, the DWD, ECMWF, NOAA, Météo-France, the JMA and
others, each under its own open licence, listed on
[their licence page](https://open-meteo.com/en/licence). A reading a traveller
recorded themselves names whoever took it and is credited to nobody else.

Exchange rates from the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html),
whose reference rates may be reproduced with the source acknowledged. This
server fetches the whole published table; the ECB is not told which trip,
currency or date is of interest. The change made: the ECB quotes every
currency against the euro, so a rate here has been cross-divided into the
journal's own currency and rounded to six figures. A costs page that used a
looked-up rate names the ECB and the date beneath the totals. A rate somebody
typed in themselves carries no citation.

## What is not promised {#not-promised}

This site is offered as it is, without warranty of any kind.

**No responsibility is accepted for lost data.** Journals are backed up, but a
backup can fail and a restore can be incomplete. If a trip matters to you,
keep your own copy — the owner's page has the download.

**No responsibility is accepted for a data breach.** The software is written
with security taken seriously — credentials are hashed, tokens expire, private
trips are refused rather than merely hidden, and the code is reviewed for it —
but no system is proof against every attack. Do not put anything on this site
whose disclosure you could not live with.

**No liability is accepted for the content of other people's sites**, or for
what happens to you on them, including any site a link here leads to.

By using this site you accept that any liability, to the extent the law
permits it, is excluded.

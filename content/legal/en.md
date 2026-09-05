## Who runs this

Fernscout is run as a **hobby project** by Severin Lindenmann, Switzerland.
It is not a company, there is no support desk, and there is no service level
agreement behind it.

Contact: <agent@fernscout.ch>

The software is open source under the AGPL-3.0 licence and can be read in
full at [github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).

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

## No tracking

There is **no analytics of any kind** on this site. No Google Analytics, no
Plausible, no Matomo, no pixels, no advertising network, no fingerprinting, no
third-party fonts or scripts. Nothing on these pages reports your visit to
anybody.

Cookies are only ever set for signing in — a session, or an identity that
proves your email address to the site. There is no cookie banner because there
is nothing to consent to.

The web server keeps ordinary access logs (IP address, time, page requested)
for a short period, which is what a server needs in order to be operated and
defended at all.

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

That is the whole list. There is nobody else.

The mail this site sends goes through **Proton Mail in Switzerland** —
encrypted at rest and under Swiss privacy law, rather than through a provider
that reads mail to sell against it. Once a message leaves for an address that
is not itself on Proton it is ordinary email, which is worth knowing before
anybody puts something sensitive in a reply.

## Your rights

Under the GDPR and the Swiss FADP you may ask what is stored about you, ask
for it to be corrected, and ask for it to be deleted. Write to the address at
the top of this page. There is one person reading it, so please be patient.

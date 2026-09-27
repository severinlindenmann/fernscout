# Legal page review, September 2026: work order

This is a handoff for whoever carries out the fixes, whether a person or an
agent. It covers four things:

- fernscout.ch's `/legal` page (imprint and privacy policy)
- the matching repository template and README
- one code change: Deepgram's EU endpoint
- the App Store points that depend on them

It was written from the live German page as of 2026-09-25 and from this
repository at `c80b7ac`.

This is not legal advice. Parts marked **operator decides** or **verify** must
not be filled in by guessing. AGENTS.md applies throughout: write only what is
true, and report what was actually done, not what was proposed.

## Where things live

| What | Where | How it changes |
| --- | --- | --- |
| The live imprint | `$CONTENT_DIR/legal/de.md` and `en.md` on the server (`/var/lib/fernscout/content/legal/`) | Edited on the server as the `fernscout` user (`docs/runbook.md`). **Never committed.** The operator's name and address must not enter git (B2249) |
| The public template | `site/legal/de.md` and `en.md` | PR to this repository. Placeholders stay placeholders |
| Transcription | `lib/helper/transcribe.ts` | PR to this repository |
| Credits and Stripe checkout | `fernscout-features` (`credits/`) | PR to the private repository |

`lib/legal.ts` serves `$CONTENT_DIR/legal/` first and falls back to the
template, so a template PR changes nothing on fernscout.ch. The live page only
changes when the server files are edited.

Before editing on the server, copy both files to somewhere outside
`DATA_DIR`/`CONTENT_DIR` (for example `/root/fernscout-legal-backups/`),
and write as `sudo -u fernscout`, never plain `sudo`.

## Decisions already taken

- **Contact address stays exactly as it is.** Do not change it or suggest
  another.
- **Transcription stays with Deepgram, moved to its EU endpoint** (part A),
  with Deepgram's standard DPA signed (part B).
- **"Hobby project" / "Hobbyprojekt" goes**, on the live page, in the
  template and in the README. Selling credits and prints is commercial, and
  the App Store trader declaration (part E) says so publicly anyway.

---

## A. Code: Deepgram EU endpoint (this repository)

**Why:** audio currently goes to `https://api.deepgram.com/v1/listen`, which
is processed in the US. Deepgram's EU endpoint `https://api.eu.deepgram.com`
keeps processing inside EU AWS regions and supports the same Nova-3 model
([announcement](https://deepgram.com/learn/deepgram-eu-endpoint-now-generally-available),
[custom endpoints](https://developers.deepgram.com/reference/custom-endpoints)).

**Change:**

1. In `lib/helper/transcribe.ts`, replace the hardcoded `DEEPGRAM_URL` with
   the EU host as the default: `https://api.eu.deepgram.com/v1/listen`.
   Allow an override through an environment variable such as
   `DEEPGRAM_API_URL`, for a self-hoster who wants the US endpoint or a
   dedicated one. Validate that the override is an `https:` URL. Leave the
   rest of the request unchanged: `model=nova-3`, the explicit `language`,
   `smart_format`, `mip_opt_out=true`.
2. **Verify before merging** that an existing Deepgram key works against the
   EU host, and that `nova-3` supports every language in `SPEECH_LANGUAGES`
   there (`en`, `de`, `de-CH`, `hu`, `fr`, `it`). If Deepgram needs an EU
   project or key, write that into `.env.example` and `docs/capabilities.md`
   instead of guessing.
3. Check whether EU pricing differs. If it does, update
   `costs.transcriptionPerThousandMinutesRappen` (and the comment in
   `lib/config.ts` that quotes the per-minute cost). If it doesn't, leave it.
4. Documentation to update in the same PR:
   - `.env.example`, speech-to-text block: the new optional variable and the
     EU default
   - `docs/capabilities.md` / `docs/helper.md`, wherever the transcription
     provider's location is described
   - `site/legal/en.md` and `de.md`: the Deepgram row in "Where the data goes"
     says **United States** today. Change it to Deepgram Inc., processing in
     the EU (Deepgram is a US company; processing location EU)
   - the file comment at the top of `transcribe.ts`
5. Test: extend `test/helper-transcribe.test.ts` so that the request goes to
   the EU host by default and to the override when it is set. Stub `fetch`,
   make no network call, and keep dry-run behaviour unchanged.
6. `VERIFY_WILL_WAIT=1 npm run verify` must pass.
7. After deploying, make **one real dictation on fernscout.ch** and confirm
   it transcribes. Only then change the live legal text (C4/C5). Until that
   request has worked, the live page must not claim EU processing.

## B. Operator tasks (no code)

These are for the operator. An agent can prepare them but cannot complete
them:

- [ ] **Deepgram DPA.** Sign Deepgram's standard Data Processing Agreement
      (it includes Standard Contractual Clauses), or chase the request already
      open with their privacy team. Record the date it was signed.
- [ ] **Data Privacy Framework check.** Look up each US provider on
      [dataprivacyframework.gov](https://www.dataprivacyframework.gov/list)
      and note whether it is certified, including the **Swiss–US** extension:
      Twilio, Stripe, Apple, Amazon Web Services, Meta, Anthropic, Deepgram.
      For a provider that is not certified, the basis is the SCCs in its DPA.
      C5 is written from this list, **not from memory**.
- [ ] **EU representative (GDPR Art. 27). Operator decides:** either appoint a
      representative in the EU, or write down (privately) why the exemption
      for occasional, low-risk processing applies. If you appoint one, their
      name and address go into C2.
- [ ] **Swiss VAT / UID. Operator decides:** if the business is registered
      for VAT or has a UID, add it in C2. If not, add nothing.
- [ ] **Terms of use (part D) values:** credit prices, whether credits
      expire, refund policy, delivery terms for prints.

## C. Live imprint on the server (`$CONTENT_DIR/legal/de.md` + `en.md`)

Make every change in **both** languages. Keep every `{#anchor}` exactly as it
is, because `/legal#privacy` is the App Store privacy URL. Change `updated:`
only after reading the whole page against what the software does.

### C1. Summary, first bullet

- DE: `Betrieben von einer Einzelperson in der Schweiz.`
  (This also fixes the current "in Schweiz".)
- EN: `Run by one person in Switzerland.`

### C2. `## Wer das hier betreibt {#operator}`

Replace the first paragraph ("Fernscout™ ist ein **Hobbyprojekt** … keine
zugesicherte Verfügbarkeit.") and the contact block. **Keep the existing name,
address and contact email exactly as they are on the server.** The brackets
below only mark where they go.

DE:

```markdown
Fernscout™ wird von [Name] (Einzelunternehmen) betrieben.

[Name], [Strasse], [PLZ Ort], Schweiz
E-Mail: [bestehende Kontaktadresse]

**Verantwortlich** für die Bearbeitung von Personendaten im Sinne des
Schweizer Datenschutzgesetzes (DSG) und der Datenschutz-Grundverordnung
(DSGVO) ist [Name], erreichbar unter der Adresse oben.

Fernscout wird von einer einzelnen Person betrieben. Eine bestimmte
Verfügbarkeit wird nicht zugesichert. Anfragen werden in der Regel innerhalb
weniger Tage beantwortet.
```

EN:

```markdown
Fernscout™ is operated by [Name] (sole proprietorship).

[Name], [Street], [Postcode Town], Switzerland
Email: [existing contact address]

The **controller** for personal data under the Swiss Federal Act on Data
Protection (FADP) and the GDPR is [Name], reachable at the address above.

Fernscout is run by one person. No particular availability is guaranteed;
enquiries are usually answered within a few days.
```

If B decided on a UID/VAT number or an EU representative, add one line each
after the address. Keep the paragraphs "Wer wofür verantwortlich ist",
"Der Quellcode ist öffentlich" and the TRADEMARK sentence as they are.

### C3. Reading helper conversations: its own row and legal basis

The table currently lists helper conversations only as "Vertrag / weitermachen".
Reading them to improve the product is a separate purpose. Add a row directly
below the conversations row:

| DE | |
| --- | --- |
| Was | **Einsicht in Helfer-Gespräche** durch den Betreiber |
| Wozu | Den Helfer verbessern |
| Grundlage | Berechtigtes Interesse; der Besitzer kann jederzeit widersprechen (abschalten auf seiner Seite) |
| Wie lange | Solange die Gespräche bestehen |

| EN | |
| --- | --- |
| What | **Operator reading helper conversations** |
| Why | To improve the helper |
| Basis | Legitimate interest; the owner can object at any time (switch it off on their page) |
| How long | As long as the conversations exist |

In the paragraph below the table, replace "**Wir lesen** Helfer-Gespräche"
with "**Der Betreiber liest** Helfer-Gespräche" (EN: "**We read**" becomes
"**The operator reads**"). The rest of the page describes one person, so it
should not say "we" here.

### C4. Deepgram row in `## Wohin die Daten gehen {#recipients}`

**Only after A.7 has succeeded and B's DPA is signed.**

- DE, column "Wo": `USA` becomes `Verarbeitung in der EU (Unternehmen in den USA)`
- EN, column "Where": `United States` becomes `Processed in the EU (US company)`

### C5. Transfers paragraph

Replace the whole paragraph that starts **"Übermittlungen ausserhalb der
Schweiz und der EU."**, including the sentence admitting there is no Deepgram
DPA. The current text leaves out Twilio, Stripe, Apple and AWS entirely.
Write it from the checklist in B. The template below assumes each provider is
either certified or covered by SCCs; delete whatever does not match the facts.

DE:

```markdown
**Übermittlungen ausserhalb der Schweiz und der EU.** Finnland, Deutschland,
Irland und Norwegen unterliegen dem EU-Datenschutzrecht; für das Vereinigte
Königreich besteht ein Angemessenheitsentscheid des Bundesrates und der
EU-Kommission. Deepgram verarbeitet Aufnahmen in der EU. Für Anbieter mit
Verarbeitung in den USA stützt sich die Übermittlung auf deren Zertifizierung
unter dem Swiss-US bzw. EU-US Data Privacy Framework ([Liste der
zertifizierten Anbieter aus B]) und, wo keine besteht, auf die
Standardvertragsklauseln in deren Auftragsverarbeitungsvertrag ([Liste aus B]).
Mit jedem Anbieter besteht ein Auftragsverarbeitungsvertrag.
```

EN:

```markdown
**Transfers outside Switzerland and the EU.** Finland, Germany, Ireland and
Norway are subject to EU data protection law; the United Kingdom is covered by
an adequacy decision of the Swiss Federal Council and the European Commission.
Deepgram processes recordings in the EU. For providers processing in the
United States, transfers rely on their certification under the Swiss–US or
EU–US Data Privacy Framework ([certified providers from B]) and, where there
is none, on the Standard Contractual Clauses in their data processing
agreement ([list from B]). A data processing agreement is in place with every
provider.
```

The last sentence may only stay if B has confirmed it for **every** row in the
table. Otherwise name the exceptions. Keep the Meta paragraph ("Meta hat zwei
Rollen") and the Stripe and Google Maps paragraphs as they are.

### C6. `## Deine Rechte {#rights}`

Delete "Es liest sie eine einzige Person, also hab bitte etwas Geduld;" (EN:
"There is one person reading it, so please be patient;"). Keep "du bekommst
innerhalb von dreissig Tagen eine Antwort" / "you will get an answer within
thirty days".

### C7. `## Was nicht versprochen wird {#not-promised}`: replace the whole section

The current blanket exclusions don't hold. Swiss law (Art. 100 OR) doesn't
allow excluding liability for intent or gross negligence, EU consumer law is
stricter still, and "no liability for a data breach" contradicts GDPR
Art. 32/82.

DE:

```markdown
## Was nicht versprochen wird {#not-promised}

Fernscout wird ohne Zusicherung einer bestimmten Verfügbarkeit angeboten.

**Sichere eigene Kopien.** Journale werden regelmässig gesichert, aber ein
Backup kann fehlschlagen und eine Wiederherstellung unvollständig sein. Wenn
dir eine Reise wichtig ist, lade sie auf deiner eigenen Seite herunter.

**Sicherheit.** Personendaten werden mit angemessenen technischen und
organisatorischen Massnahmen geschützt — Zugangsdaten werden gehasht, Tokens
laufen ab, private Reisen werden abgewiesen statt nur versteckt, und der Code
wird darauf geprüft. Kommt es trotzdem zu einer Verletzung der
Datensicherheit, werden die zuständige Behörde und die Betroffenen
informiert, wie es das Gesetz verlangt.

**Links.** Für die Inhalte fremder Seiten, auf die hier verlinkt wird, sind
deren Betreiber verantwortlich.

**Haftung.** Die Haftung ist ausgeschlossen, soweit das Gesetz es zulässt.
Ausgenommen sind Schäden aus Vorsatz oder grober Fahrlässigkeit sowie
zwingende Ansprüche nach Datenschutz- und Produkthaftpflichtrecht.
```

EN:

```markdown
## What is not promised {#not-promised}

Fernscout is offered without any guarantee of a particular availability.

**Keep your own copy.** Journals are backed up regularly, but a backup can
fail and a restore can be incomplete. If a trip matters to you, download it
from your own page.

**Security.** Personal data is protected with appropriate technical and
organisational measures — credentials are hashed, tokens expire, private trips
are refused rather than merely hidden, and the code is reviewed for it. If a
data breach happens anyway, the competent authority and the people affected
are informed as the law requires.

**Links.** The operators of other sites linked from here are responsible for
their content.

**Liability.** Liability is excluded to the extent the law permits. This does
not apply to damage caused intentionally or by gross negligence, or to
mandatory claims under data protection and product liability law.
```

### C8. Check the waitlist consent

The iPhone waitlist row says "Einwilligung" (consent). Confirm that the signup
form actually asks for it, with a sentence or a checkbox next to the field. If
it doesn't, fix the form, not the page.

## D. Terms of use (new section on the live page)

Credits are sold through Stripe (card and TWINT) and prints are ordered from
Stannp and Gelato, so buyers need terms. Add `## Nutzungsbedingungen {#terms}`
/ `## Terms of use {#terms}` after `#deleting` (or on its own page, linked
from the checkout). It must cover:

- what credits buy, and their price (**operator decides**; it must match what
  the checkout shows)
- whether credits expire (**operator decides**)
- refunds, and for EU consumers the 14-day right of withdrawal for digital
  content, with the consumer's explicit agreement that it lapses once credits
  are used (the checkout must actually collect that agreement)
- prints: what happens if a postcard or book arrives damaged or not at all
  (**operator decides**)
- ending an account: the existing deletion flow
- Swiss law applies; place of jurisdiction (**operator decides**); mandatory
  consumer protection in the buyer's country stays unaffected

**Do not publish this section until every "operator decides" item has a real
answer.** An empty field is better than a made-up refund policy.

## E. App Store

- [ ] **Credits purchase inside the iOS app (most likely rejection
      reason).** Nothing in `fernscout-features/credits` checks
      `isNativeShell()` (`components/nativeShell.ts`). Credits spent on
      digital features (the AI helper, transcription) must be sold through
      In-App Purchase or be hidden in the app (App Store guideline 3.1.1).
      Printed postcards and photobooks are physical goods and may use Stripe.
      Check what credits are actually spent on, then either hide the buy
      button in the native shell or split it, in a `fernscout-features` PR.
- [ ] **Trader status (EU Digital Services Act).** In App Store Connect,
      declare the account a trader. Apple then publishes the address, phone
      and email. That is consistent with C2, and it is why "hobby project"
      had to go.
- [ ] **Support URL:** point it at `https://fernscout.ch/legal#operator`, or at
      a support page that shows the contact address.
- [ ] **Privacy URL:** `https://fernscout.ch/legal#privacy` (already in place).
- [ ] **App Privacy labels** must match section C: precise location (in the
      background, only for trips with recording on), photos, audio (not
      stored), email address, phone number, user content, and none of it
      used for tracking.

## F. Repository template and README (this repository)

In the same PR as A, or a separate small one:

- `site/legal/en.md` and `de.md`: apply C1, C2, C3, C6 and C7 in template
  form, keeping `[Operator name]`-style placeholders. Remove "hobby project"
  / "Hobbyprojekt" from the summary and from `#operator`. Keep the "Fill in
  this paragraph…" guidance in the transfers paragraph, because it is
  instructions for a fork. Name the Deepgram EU endpoint there once A has
  landed.
- `README.md`, "fernscout.ch, the hosted edition": replace "fernscout.ch is a
  hobby project run by one person, with no uptime or support guarantee" with
  "fernscout.ch is run by one person, with no uptime guarantee". Keep the
  rest of the sentence.
- Every `{#anchor}` must stay identical across languages.
- `test/depersonalised.test.ts` must stay green: no real name or address in
  `site/legal/`.

## Order

1. B: DPA, Data Privacy Framework check, operator decisions (runs alongside
   the rest)
2. A: code PR, then deploy, then one real dictation
3. C1–C3, C6–C8 on the server (they don't depend on anything above)
4. C4 and C5 on the server, once A.7 and B are done
5. F: template and README PR
6. D once the operator's values exist, E before the next App Store submission

## Done when

- [ ] `/legal` in DE and EN no longer contains "Hobbyprojekt" or "hobby
      project"
- [ ] The page names the controller, and every US provider in the recipients
      table has a stated transfer basis that was checked, not assumed
- [ ] A real dictation on fernscout.ch went to `api.eu.deepgram.com`, and the
      page says so
- [ ] The liability section has no blanket exclusions
- [ ] The Stripe credit purchase is either absent from the iOS app or limited
      to physical goods
- [ ] `npm run verify` is green for every repository PR
- [ ] Every server edit was made as `sudo -u fernscout`, with the originals
      backed up outside `DATA_DIR`

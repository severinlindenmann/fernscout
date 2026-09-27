# Glossary

One term per concept, in each maintained language. Use these words in prose,
UI strings and mail — not a synonym that happens to mean the same thing.
German uses **ß** rather than Swiss `ss`, „…" quotes, and **Reisetagebuch**
(short form **Tagebuch**) for the product itself.

| Concept | EN | DE | HU |
| --- | --- | --- | --- |
| The product | journal | Reisetagebuch (short: Tagebuch) | útinapló (short: napló) |
| Editing | studio | Studio | stúdió |
| Built-in model, this instance's own | assistant | Assistent | asszisztens |
| External MIT tool | Fernscout Helper | Fernscout Helper | Fernscout Helper |
| External client holding a key | agent | Agent | ágens |
| Bearer credential, in the API reference and skills only | token | Token | token |
| Credential, everywhere else (UI, mail, guides) | key | Schlüssel | kulcs |
| 20-minute one-shot credential | handover code | Übergabe-Code | átadási kód |
| The person reading, approved into a trip or photo | reader | Leser:in | olvasó |
| Trip or photo gate, and the invite kind | guest | Gast | vendég |
| Journal visibility, advertised | listed | gelistet | listázott |
| Journal visibility, not advertised | unlisted | ungelistet | nem listázott |
| Whoever keeps the journal | owner | Besitzer:in | tulajdonos |
| A drawn figure on a trip | figure | Figur | figura |
| A person travelled with, in prose and UI | buddy | Buddy | buddy |
| The same person, as an API/trip field | trip people (`people`) | Mitreisende (`people`) | útitársak (`people`) |
| One calendar day's document | day | Tag | nap |
| One of several write-ups on the same day | update | Update | frissítés |
| Storage/code word only, never in prose | entry | Entry | entry |
| Putting a day on the site | publish | veröffentlichen | közzététel |
| Taking a day off the site | take down | zurückziehen | visszavonás |
| Giving somebody access (never "share") | invite / grant access | einladen / Zugang gewähren | meghívás / hozzáférés adása |
| Whoever runs the server | operator | Betreiber:in | üzemeltető |
| This installation | this server / instance | dieser Server / diese Instanz | ez a szerver / ez a példány |
| Per-journal settings | journal (config) | Journal-Konfiguration | napló-beállítás |
| Server config file | server config (`FERNSCOUT_CONFIG`, default `site/config.json`) | Server-Konfiguration | szerver-konfiguráció |
| Journal config file | journal config (`content/<user>/config.json`) | Journal-Konfiguration | napló-konfiguráció |
| Content format | JSON documents and photographs | JSON-Dokumente und Fotos | JSON dokumentumok és fényképek |
| Raw private location data | GPS history | GPS-Verlauf | GPS-előzmények |
| Derived public line on the map | track | Strecke | útvonal-nyom |
| Planned itinerary only | route | Route | útiterv |
| The complete, self-hostable codebase | open edition | offene Edition | nyílt kiadás |
| fernscout.ch and its paid features | hosted edition | gehostete Edition | üzemeltetett kiadás |
| The private companion codebase | the private repository | das private Repository | a privát repó |
| Trip expenses | costs / spent | Kosten / ausgegeben | költségek / elköltve |
| The metered unit for model/send actions | credits | Credits | kredit |
| A credit purchase's price | price | Preis | ár |
| A credit balance | balance (Guthaben, DE only) | Guthaben | egyenleg |
| What running the server costs its operator | running costs | Betriebskosten | üzemeltetési költség |
| A config key under `features.*` | feature | Feature | funkció |
| Decided once for the whole server | server-wide (feature) | serverweit | szerver szintű |
| A journal's own switch | per journal (feature) | pro Journal | naplónkénti |
| Fixed by code, not a journal's vote | operator-only (feature) | nur für Betreiber:innen | csak üzemeltetői |

## Notes

- **"helper"** is retired as a name for the built-in model — see the
  **assistant** row above. `/api/helper/**` stays a code name only; it names
  no product.
- **"traveller"** is retired as a synonym for the owner or for trip people —
  use **owner**, **buddy** or **figure**, whichever the sentence means.
- A per-journal feature can only *narrow* a server-wide default (`mail`,
  `whatsapp`, `whatsappInbound`) or opt further *in* where the server already
  allows it (`extract`, `routeRecording`, `mapRelief`) — see
  `docs/capabilities.md` for which is which.

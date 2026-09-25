---
updated: 2026-09-25
summary:
  - Ein Hobbyprojekt einer einzelnen Person in [Land], keine Firma.
  - Alles liegt auf einem Server in Helsinki, Finnland, mit einem zweiten verschlüsselten Backup in Deutschland.
  - Kein Tracking, keine Werbung, keine Skripte von Dritten. Cookies nur, damit du angemeldet bleibst und deine Einstellungen behältst.
  - Externe Dienste werden nur für die Funktion genutzt, die sie braucht, und nur, wenn jemand sie nutzt.
  - Der KI-Helfer sieht nur, was du ihm gibst, und erst, nachdem du zugestimmt hast.
  - Du kannst ein Journal jederzeit herunterladen oder löschen und fragen, was über dich gespeichert ist.
---

<!-- Diese Datei ist die VORLAGE des Repositories, die jeder Klon mitbekommt.
     Das echte Impressum dieser Instanz liegt ausserhalb des Checkouts — siehe
     lib/legal.ts und docs/running-locally.md für den Ort, an dem eine echte
     legal/<locale>.md diese Datei überschreibt, ohne je committet zu werden.

     `updated:` ist das Datum, an dem jemand diese Seite zuletzt mit dem
     verglichen hat, was die Software tut. Ein `{#id}` hinter einer
     Überschrift legt den Link auf diesen Abschnitt fest; in jeder Sprache
     gleich lassen — /legal#privacy ist die Datenschutz-URL im App Store. -->

## Wer das hier betreibt {#operator}

Fernscout™ ist ein **Hobbyprojekt** von [Name des Betreibers], [Land]. Es ist
keine Firma, es gibt keinen Support und keine zugesicherte Verfügbarkeit.

[Name des Betreibers], [Strasse und Hausnummer], [PLZ und Ort], [Land]

Kontakt: <[Kontakt-E-Mail]>

**Wer wofür verantwortlich ist.** [Name des Betreibers] ist für den Betrieb
dieser Seite verantwortlich: Konten und Anmeldung, den Server und seine Logs,
Zahlungen und die unten aufgeführten Dienste. Was in ein Journal kommt — Texte,
Fotos und die Menschen darin — entscheidet dessen Besitzerin oder Besitzer,
ebenso, wer es lesen darf. Für diese Inhalte arbeitet diese Seite in ihrem
Auftrag: Sie speichert sie, zeigt sie den erlaubten Leuten und schickt sie
dorthin, wohin sie gebeten wurde.

Der Quellcode ist öffentlich und vollständig einsehbar auf
[github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).
Er steht unter der [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0):
kostenlos zu nutzen, zu ändern, selbst zu betreiben und weiterzugeben, so
lange man möchte, ohne Einschränkung auch für ein konkurrierendes Angebot.
Der Name und das Logo von Fernscout sind von dieser Lizenz nicht erfasst —
siehe die `TRADEMARK.md` des Projekts.

## Was gespeichert wird, und warum {#privacy}

Die genannten Rechtsgrundlagen sind die der DSGVO, für Lesende in der EU. Das
Schweizer Recht verlangt dieselben Angaben ohne sie.

| Was | Wozu | Grundlage | Wie lange |
| --- | --- | --- | --- |
| **Journal-Inhalte** — Texte, Fotos, Daten, Kosten, die Menschen einer Reise | Sie sind das Journal | Vertrag mit dem Besitzer | Bis der Besitzer sie löscht |
| **E-Mail-Adressen** — von Besitzern, von Mitreisenden, von eingeladenen Lesenden | Die Adresse ist hier der Zugang: Es gibt keine Passwörter, die Anmeldung schickt einen Code | Vertrag | Solange das Konto oder die Einladung besteht |
| **Sitzungen und Tokens** — mit dem Namen des Browsers, der sich angemeldet hat, nie seiner IP-Adresse | Damit ein Browser angemeldet bleibt und ein Agent schreiben kann | Vertrag | Eine Lese-Sitzung ein Jahr, ein Agenten-Token sieben Tage; jederzeit widerrufbar |
| **Lesende und Kontakte** — Namen, E-Mail-Adressen, Telefonnummern, Postadressen und die eigenen Notizen des Besitzers dazu | Damit ein Besitzer einen Tag, eine Postkarte oder eine Einladung an die Leute schicken kann, die er ausgewählt hat | Berechtigtes Interesse des Besitzers | Bis der Besitzer sie entfernt. Telefonnummern und Postadressen werden verschlüsselt gespeichert und nie einem Agenten gezeigt |
| **Reaktionen** — welches Emoji an einem Tag hinterlassen wurde, unter einem Zufallscode, den dein Browser behält | Damit du einmal reagieren und es zurücknehmen kannst | Berechtigtes Interesse | Solange das Journal besteht |
| **Gespräche mit dem Helfer**, dazu Nachrichten, Fotos, Dokumente und Abschriften von Sprachnachrichten per WhatsApp oder SMS | Damit ein Besitzer dort weitermachen kann, wo er aufgehört hat | Vertrag | Bis der Besitzer sie oder das Journal löscht |
| **Standortverlauf** | Damit die Karte einer Reise die wirklich gefahrenen Strassen zeigt | Einwilligung, pro Reise | Bis der Besitzer ihn löscht, monatsweise oder ganz |
| **Seitenaufrufe**, bei Journalen, deren Autor die Zählung eingeschaltet hat | Damit ein Autor sieht, ob seine Leute lesen | Berechtigtes Interesse | Etwa neunzig Tage |
| **Anfrage-Log** — die aufgerufene Seite, die Zeit, der Name des Browsers; keine IP-Adresse | Um den Server zu betreiben und zu schützen | Berechtigtes Interesse | 14 Tage |
| **Kopien der Mails, die diese Seite verschickt hat** | Um herauszufinden, warum ein Anmeldecode nicht ankam | Berechtigtes Interesse | Zwei Tage, nie im Backup |
| **Zahlungen, Credits und Druckaufträge** | Buchhaltung | Vertrag und Gesetz (Schweizer Buchführungspflicht) | Zehn Jahre; siehe [Löschen](#deleting) |
| **Verschlüsselte Backups** von allem oben | Damit eine kaputte Festplatte kein Journal beendet | Berechtigtes Interesse | 14 Tage auf dem Server, 7 Tage in der zweiten Kopie |

**Nur der Besitzer eines Journals spricht mit dem Helfer** — im Web, weil dafür
eine Anmeldung nötig ist, und über WhatsApp, weil nur eine Telefonnummer, die
der Besitzer bereits bestätigt hat, je an ein Journal gebunden wird. Eine
Nachricht von einer anderen Nummer bekommt eine feste Antwort, die höflich
ablehnt und auf die Anmeldung verweist, und erreicht das Modell nie. **Wir
lesen Helfer-Gespräche, um zu sehen, was besser werden kann, und ein Besitzer
kann das abschalten** — auf seiner eigenen Seite, jederzeit. Abschalten löscht
nichts; es heisst nur, dass niemand ausser ihm liest, was da ist und was noch
kommt.

**Ein Standortverlauf** existiert nur in einem Journal, dessen Besitzer ihn
hineingelegt hat: eine importierte Datei (ein Google- oder GPX-Export) oder
Positionen, die die iPhone-App während einer Reise aufgezeichnet hat, für die
er die Aufzeichnung eingeschaltet hat. Er geht nur an den eigenen Server dieses
Journals. Lesende sehen ihn nie: Die Karte einer Reise zeigt eine daraus
gezogene Linie nur für Tage, die sie ohnehin lesen dürfen, nichts aus den
letzten 24 Stunden, nie die ersten oder letzten 500 Meter einer Strecke und
nichts in der Nähe von Orten, die der Besitzer als privat markiert hat. Nur
dem Besitzer selbst kann der Name des Ortes angeboten werden, an dem ein Tag
verbracht wurde — ermittelt auf diesem Server, ohne jemanden zu fragen.

**Schick nur, was du teilen darfst.** Ein Foto, auf dem jemand anderes zu sehen
ist, oder ein Dokument mit dem Namen einer anderen Person — diese Person wurde
nie um Einwilligung gefragt, und weder diese Seite noch die Software kann sie
für sie erteilen.

Eine E-Mail-Adresse brauchst du, um dich anzumelden. Alles andere ist
freiwillig, und jede Funktion sagt, was sie braucht, wenn du sie nutzt.

## Auf deinem Gerät {#device}

Es gibt keinen Cookie-Banner, weil nichts auf deinem Gerät dazu da ist, dir zu
folgen: Jeder Eintrag unten ist entweder für das nötig, worum du die Seite
gebeten hast, oder merkt sich eine Entscheidung, die du getroffen hast.

| Name | Art | Wozu | Wie lange |
| --- | --- | --- | --- |
| `fs_session` | Cookie | Hält dich in einem Journal angemeldet | Ein Jahr |
| `fs_identity` | Cookie | Merkt sich, dass du deine E-Mail-Adresse bestätigt hast, damit du das nicht bei jedem Journal neu tun musst | Ein Jahr |
| `fs.locale` | Cookie | Die Sprache, die du gewählt hast | Ein Jahr |
| `fs.journal` | Cookie | Für welches Journal ein Willkommenslink war | Ein Jahr |
| Farbschema, Währung, Sprache für Diktate, weggeklickte Hinweise | Browser-Speicher | Entscheidungen, die du auf diesem Gerät getroffen hast | Bis du sie löschst |
| Ein Reaktions-Code | Browser-Speicher | Ein Zufallscode, damit du ein Emoji zurücknehmen kannst | Bis du ihn löschst |
| Ein Push-Token | Browser-Speicher | Damit dieses Gerät Benachrichtigungen wieder abbestellen kann | Bis du ihn löschst |
| Offline-Kopien | Browser-Cache | Seiten, die du gelesen hast, und ganze Reisen, die du für unterwegs gespeichert hast | Bis du sie löschst oder die Reise entfernst |

**Es gibt keine Analyse durch Dritte.** Kein Google Analytics, kein Plausible,
kein Matomo, keine Pixel, kein Werbenetzwerk, keine Schriften oder Skripte von
fremden Servern. Nichts auf diesen Seiten wird von einem anderen Server
geladen.

**Die Besucherzählung erkennt dich nicht.** Der Autor eines Journals kann für
sein eigenes Journal eine Zählung einschalten. Sie nutzt kein Cookie und kein
Skript. Um zwei Lesende am selben Tag auseinanderzuhalten, bildet der Server
einen kurzen Code aus deiner Internetadresse und dem Namen deines Browsers,
vermischt mit einem Geheimnis, das zufällig erzeugt, nur im Arbeitsspeicher
gehalten und jeden Tag verworfen wird. Deine IP-Adresse selbst wird nie
aufgeschrieben, und wer morgen wiederkommt, zählt als jemand Neues. Die Seite,
von der du kamst, wird absichtlich nicht erfasst, weil sie zeigen würde, wo ein
privater Link herumgereicht wurde.

## Wohin die Daten gehen {#recipients}

Alles liegt auf einem virtuellen Server der **Hetzner Online GmbH** in deren
Rechenzentrum in **Helsinki, Finnland**. Verschlüsselte Backups liegen auf
diesem Server und im **Hetzner Object Storage in Falkenstein, Deutschland**.
Es gibt kein CDN und keine Drittanbieter-Datenbank.

Die Dienste unten werden nur für das genutzt, was in der Zeile steht, und nur,
wenn jemand diese Funktion nutzt. Keinem wird etwas zur Analyse, für Werbung
oder zur Profilbildung übergeben.

| Dienst | Wo | Genutzt, wenn | Was er bekommt |
| --- | --- | --- | --- |
| **Proton AG** | Schweiz | Anmeldecodes, Einladungen, Benachrichtigungen per E-Mail | Die Adresse und die Nachricht |
| **Twilio Inc.** | USA | Jemand wollte einen Code oder eine Benachrichtigung per SMS oder hat dem Journal eine SMS geschickt | Die Telefonnummer und den Text der Nachricht |
| **Meta Platforms Ireland** (WhatsApp) | Irland und USA | Jemand will per WhatsApp von neuen Tagen erfahren, oder die bestätigte Nummer eines Besitzers schreibt dem Journal | Die Telefonnummer und die Nachricht, das Foto, das Dokument oder die Sprachnachricht |
| **Apple** (Push-Benachrichtigungen) | USA | Ein Gerät mit der iPhone-App will benachrichtigt werden | Ein Geräte-Token sowie Titel und Link der Benachrichtigung |
| Der Push-Dienst deines Browsers (Google, Mozilla oder Apple) | Je nach Browser | Ein Browser will benachrichtigt werden | Eine verschlüsselte Nachricht, die er nicht lesen kann, und eine Geräteadresse |
| **Anthropic PBC** | USA | Der Besitzer hat den Helfer genutzt, nachdem er zugestimmt hat — siehe [KI und Stimme](#ai) | Was der Besitzer ihm für diese eine Anfrage gegeben hat |
| **Deepgram Inc.** | USA | Der Besitzer hat mit dem Helfer gesprochen oder eine Sprachnachricht geschickt | Die Aufnahme und ihre Sprache |
| **Stripe** | Irland und USA | Jemand hat Credits gekauft | Den Betrag, die E-Mail-Adresse für die Quittung und den Namen des Journals als Referenz. Karten- oder TWINT-Daten gibst du auf Stripes eigener Seite ein, nie auf dieser |
| **Stannp Ltd** | Vereinigtes Königreich | Jemand hat eine gedruckte Postkarte verschickt | Bild und Text der Postkarte sowie Name und Postadresse der Empfängerin oder des Empfängers |
| **Gelato ASA** | Norwegen | Jemand hat ein gedrucktes Fotobuch bestellt | Das Buch sowie Name, Postadresse und E-Mail-Adresse der Empfängerin oder des Empfängers |
| **Amazon Web Services** (offene Höhendaten) | USA | Ein Fotobuch mit Reliefkarte wurde erstellt | Welche Kartenkacheln gebraucht werden — daraus lässt sich ungefähr ablesen, wo die Reise war, aber nichts über eine Person |
| **Komoot GmbH** (Ortssuche Photon) | Deutschland | Jemand hat eine Adresse oder einen Ort gesucht oder einen Standort geteilt | Die eingetippten Wörter oder die Koordinaten. Die Anfrage kommt von diesem Server, nicht von deinem Browser |
| **Open-Meteo** | Deutschland | Ein Journal wollte wissen, wie das Wetter an einem Tag war | Koordinaten und Datum dieses Tages. Von diesem Server |
| **Europäische Zentralbank** | Deutschland | Eine Reise brauchte einen Wechselkurs | Nichts: Abgefragt wird ein ganzes veröffentlichtes Dokument |

**Übermittlungen ausserhalb der Schweiz und der EU.** Finnland, Deutschland,
Irland und Norwegen fallen unter die Datenschutzregeln der EU, das Vereinigte
Königreich unter einen Angemessenheitsbeschluss. Für die Dienste in den USA
stützt sich die Übermittlung auf die Standard-Datenverarbeitungsbedingungen des
jeweiligen Anbieters, die bei der Einrichtung des Kontos akzeptiert und nicht
verhandelt wurden: bei Meta und Anthropic auf das **Swiss-US Data Privacy
Framework**; bei Meta zusätzlich auf die **Business Data Processing Terms** und
das **Business Data Transfer Addendum**; bei Anthropic auf die **Commercial
Terms**, die eine Auftragsverarbeitungsvereinbarung enthalten. Die
Datenverarbeitungsbedingungen von Deepgram werden nicht auf dieselbe Weise per
Klick akzeptiert, und ob für diese Instanz eine vorliegt, wird ehrlich gesagt:
nein, eine Anfrage an die Datenschutzstelle von Deepgram ist gestellt und
noch offen.

**Meta hat zwei Rollen.** Für die Inhalte deiner Nachrichten handelt Meta im
Auftrag dieses Journals und erklärt, sie nicht für gezielte Werbung zu nutzen.
Getrennt davon, und auf eigene Rechnung, hält Meta WhatsApp-Kontodaten für
Plattformsicherheit und Betrugserkennung; das ist Metas Beziehung zu dir als
WhatsApp-Nutzerin oder -Nutzer, beschrieben in
[WhatsApps eigener Datenschutzerklärung](https://www.whatsapp.com/legal/privacy-policy).

**Was Stripe mit Zahlungsdaten macht**, regelt
[Stripes Datenschutzerklärung](https://stripe.com/privacy).

**Ein Link nach draussen ist kein Dienst in dieser Liste.** Unter der Karte
einer Reise, und in manchen E-Mails, steht «In Google Maps öffnen». Das ist ein
gewöhnlicher Link mit den Koordinaten eines Ortes. Bis jemand darauf klickt,
geht nichts an Google. Nach dem Klick bist du auf Googles Seite, wo
[Googles Datenschutzerklärung](https://policies.google.com/privacy) gilt und
dieser Betreiber weder Einfluss noch Einblick hat.

## KI und Stimme {#ai}

Der Helfer kann einen Tag ausformulieren, Fotos beschriften, einen
Kontoauszug in die Kosten einer Reise übernehmen, aus einem Foto von
Mitreisenden gezeichnete Figuren machen und einen gesprochenen Satz verstehen.
**Für jedes davon wird einzeln gefragt**, in der App, bevor etwas verschickt
wird: deine Worte, deine Fotos, deine Stimme, deine Kontoauszüge. Die Frage
nennt die Firma, an die es ginge. Du kannst ein Ja jederzeit auf derselben
Seite zurücknehmen, danach wird nichts mehr verschickt.

| Du hast zugestimmt zu | Geht an | Was verschickt wird |
| --- | --- | --- |
| Deinen Worten | Anthropic | Was du getippt oder gesagt hast, und die Fakten, die dein Tag ohnehin trägt: Datum, Ort, Land und wie viele Fotos darauf sind, zwischen welchen Uhrzeiten |
| Deinen Fotos | Anthropic | Die Fotos, die du beschriften oder in Figuren verwandeln lassen willst — auf denen Menschen zu sehen sein können |
| Deinen Kontoauszügen | Anthropic | Die Kopfzeile und fünf Beispielzeilen, damit er erkennt, welche Spalte was ist. Nie die ganze Datei |
| Deiner Stimme | Deepgram | Die Aufnahme und ihre Sprache |

**Nichts erreicht eine dieser Firmen, solange der Besitzer den Helfer nicht
nutzt.** Ein Journal zu lesen, löst nie eine Anfrage aus. Lesende können keine
auslösen, und Fremde, die der WhatsApp-Nummer eines Journals schreiben, auch
nicht. **Kein Standortverlauf, keine Kontakte und keine Adressen werden je**
an eine der beiden geschickt.

**Die Sprachaufnahme wird nie gespeichert.** Sie geht in einer einzigen
Anfrage an den Transkriptionsdienst und wird verworfen, wenn die Anfrage
endet; keine Kopie landet auf diesem Server, in einem Backup oder in einem
Export. Der Text bleibt, weil der Text das ist, worum gebeten wurde. Beide
Dienste werden nur für diese eine Anfrage genutzt, und keiner wird gebeten,
etwas aufzubewahren oder damit zu trainieren.

## Die iPhone-App {#iphone}

Die App zeigt dieselbe Seite, also gilt alles oben auch für sie. Was sie
hinzufügt:

- **Fotos.** Die App liest nur die Fotos, die du auswählst, und lädt sie mit
  ihren Originalen in dein eigenes Journal.
- **Standort, nur für eine Reise, für die du die Aufzeichnung eingeschaltet
  hast.** iOS fragt nach «Immer»-Zugriff, und eine Meldung auf dem Telefon
  nennt Server und Journal, bevor die Aufzeichnung beginnt. Die Positionen
  gehen nur an dein eigenes Journal. Die Aufzeichnung stoppt von selbst am Tag
  nach dem Ende der Reise, ausser du lässt sie weiterlaufen, und du kannst sie
  jederzeit auf der Seite der Reise beenden.
- **Das Mikrofon**, nur während du etwas für den Helfer aufnimmst, und erst,
  nachdem du es erlaubt hast. Die Aufnahme geht an den Transkriptionsdienst,
  wie unter [KI und Stimme](#ai) beschrieben, und wird nie gespeichert.
- **Benachrichtigungen**, nur wenn du sie erlaubst, zugestellt über Apple.
- **Teilen an Fernscout** aus einer anderen App nutzt eine Anmeldung, die im
  Schlüsselbund des Telefons liegt und sieben Tage gilt.

**Alles funktioniert, wenn du Nein sagst.** Ohne Standort hat die Karte einer
Reise keine aufgezeichnete Route; ohne Mikrofon tippst du statt zu sprechen;
ohne Benachrichtigungen bekommst du keine.
Es gibt in der App kein Tracking, keine Werbe-ID und keine Analyse durch
Dritte.

## Löschen {#deleting}

**Ein Besitzer kann eine Reise oder ein ganzes Journal löschen.** Die Anfrage
verschickt eine Bestätigungsmail; gelöscht wird erst, wenn der Link darin
geöffnet wird. Dann werden Inhalte, Fotos, Lesende und jede Zeile, die zum
Journal gehörte, gelöscht. Eine kurze Notiz bleibt, damit die Adresse sagen
kann, dass das Journal gelöscht wurde, statt so zu tun, als hätte es nie
existiert. Kopien in den Backups laufen innerhalb von 14 Tagen ab.

**Zahlungsbelege bleiben.** Die Schweizer Buchführungspflicht verlangt sie
zehn Jahre lang: was gekauft wurde, zu welchem Preis, wann, und die Referenz
des Zahlungsanbieters. Namen, E-Mail- und Postadressen werden beim Löschen des
Journals daraus entfernt. Stripe behält seinen eigenen Beleg der Zahlung.

**Ein Besitzer kann jederzeit alles herunterladen**, als Zip-Datei mit den
Dateien und Fotos des Journals, auf seiner eigenen Seite.

**Lesende** können den Besitzer eines Journals bitten, sie zu entfernen, oder
an die Adresse oben auf dieser Seite schreiben.

## Deine Rechte {#rights}

Du kannst fragen, was über dich gespeichert ist, und es berichtigen, löschen
oder dir in einem Format herausgeben lassen, das du anderswo nutzen kannst. Du
kannst allem widersprechen, was auf berechtigtem Interesse beruht, und eine
Einwilligung jederzeit zurücknehmen, ohne dass das rückwirkend etwas ändert.
Es werden keine automatisierten Entscheidungen über dich getroffen. Schreib an
die Adresse oben auf dieser Seite. Es liest sie eine einzige Person, also hab
bitte etwas Geduld; du bekommst innerhalb von dreissig Tagen eine Antwort.

Du kannst dich auch beim **Eidgenössischen Datenschutz- und
Öffentlichkeitsbeauftragten** ([edoeb.admin.ch](https://www.edoeb.admin.ch))
beschweren oder, in der EU, bei der Datenschutzbehörde deines Wohnorts.

## Wetter und Wechselkurse {#sources}

**Das Wetter fragt dieser Server ab, nicht dein Browser.** Einmal, wenn ein Tag
geschrieben wird, und das Ergebnis steht in der eigenen Datei dieses Tages —
eine Seite mit Wetter zu lesen, schickt also niemandem etwas.

Wetterdaten von [Open-Meteo.com](https://open-meteo.com/), genutzt unter der
[Creative-Commons-Lizenz Namensnennung 4.0](https://creativecommons.org/licenses/by/4.0/deed.de).
Die Änderungen: Temperaturen werden in ganzen Grad und Niederschlag auf eine
Nachkommastelle gezeigt, und Open-Meteos Wettercode wird als eines von sieben
Bildern gezeichnet statt gedruckt. Open-Meteo ist selbst eine Oberfläche für
die nationalen Wetterdienste — MeteoSchweiz, den DWD, ECMWF, NOAA,
Météo-France, die JMA und andere, jeder unter seiner eigenen offenen Lizenz,
aufgeführt auf [ihrer Lizenzseite](https://open-meteo.com/en/licence). Ein
Messwert, den jemand unterwegs selbst notiert hat, nennt die Person, die ihn
genommen hat, und niemanden sonst.

Wechselkurse von der [Europäischen Zentralbank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html),
deren Referenzkurse mit Quellenangabe wiedergegeben werden dürfen. Dieser
Server lädt die ganze veröffentlichte Tabelle; die EZB erfährt nicht, welche
Reise, Währung oder welches Datum gefragt ist. Die Änderung: Die EZB notiert
jede Währung gegen den Euro, ein Kurs hier ist also in die Währung des
Journals umgerechnet und auf sechs Stellen gerundet. Eine Kostenseite, die
einen abgefragten Kurs verwendet, nennt die EZB und das Datum unter den
Summen. Ein Kurs, den jemand selbst eingetragen hat, trägt keine Quelle.

## Was nicht versprochen wird {#not-promised}

Diese Seite wird so angeboten, wie sie ist — ohne Gewährleistung.

**Für Datenverlust wird keine Haftung übernommen.** Es gibt Backups, aber ein
Backup kann fehlschlagen und eine Wiederherstellung unvollständig sein. Wenn
dir eine Reise wichtig ist, behalte eine eigene Kopie — der Download ist auf
der Seite des Besitzers.

**Für einen Datenabfluss wird keine Haftung übernommen.** Die Software ist mit
Sorgfalt gebaut — Zugangsdaten werden gehasht, Tokens laufen ab, private
Reisen werden abgewiesen statt nur versteckt, und der Code wird darauf geprüft
— aber kein System ist gegen jeden Angriff sicher. Stelle hier nichts ein,
dessen Offenlegung du nicht verkraften würdest.

**Für die Inhalte fremder Seiten wird keine Haftung übernommen**, auch nicht
dafür, was dir dort passiert — das gilt für jede Seite, zu der ein Link von
hier führt.

Mit der Nutzung dieser Seite akzeptierst du, dass jede Haftung im gesetzlich
zulässigen Rahmen ausgeschlossen ist.

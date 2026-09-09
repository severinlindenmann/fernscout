## Wer das hier betreibt

Fernscout™ ist ein **Hobbyprojekt** von Severin Lindenmann, Schweiz. Es ist
keine Firma, es gibt keinen Support und keine zugesicherte Verfügbarkeit.

Severin Lindenmann, Feldweg 18, 5512 Wohlenschwil, Schweiz

Kontakt: <agent@fernscout.ch>

Der Quellcode ist öffentlich und vollständig einsehbar auf
[github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).
Er steht unter der Lizenz [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0):
kostenlos zu nutzen, zu ändern und selbst zu betreiben, so lange man möchte,
mit einer einzigen Einschränkung — er darf nicht verwendet werden, um ein
Angebot bereitzustellen, das mit Fernscout konkurriert. Wegen dieser
Einschränkung ist die Lizenz **quelloffen, aber keine Open-Source-Lizenz** im
Sinne der Open Source Definition; dieser Begriff wird hier deshalb nicht
verwendet.

## Was nicht versprochen wird

Diese Seite wird so angeboten, wie sie ist — ohne Gewährleistung.

**Für Datenverlust wird keine Haftung übernommen.** Es gibt Backups, aber ein
Backup kann fehlschlagen und eine Wiederherstellung unvollständig sein. Wenn
dir eine Reise wichtig ist, behalte eine eigene Kopie — jedes Journal lässt
sich als das exportieren, was es ohnehin ist: Markdown und Fotos. Frag deinen
Agenten nach einem Export.

**Für einen Datenabfluss wird keine Haftung übernommen.** Die Software ist mit
Sorgfalt gebaut — Zugangsdaten werden gehasht, Tokens laufen ab, private
Reisen werden abgewiesen statt nur versteckt, und der Code wird darauf geprüft
— aber kein System ist gegen jeden Angriff sicher. Stelle hier nichts ein,
dessen Offenlegung du nicht verkraften würdest.

Mit der Nutzung dieser Seite akzeptierst du, dass jede Haftung im gesetzlich
zulässigen Rahmen ausgeschlossen ist.

## Wo die Daten liegen

Alles liegt auf einem einzelnen virtuellen Server der **Hetzner Online GmbH**
in einem **deutschen Rechenzentrum**. Nichts wird in ein anderes Land
repliziert; es gibt keinen Cloud-Speicher, kein CDN und keine
Drittanbieter-Datenbank dahinter. Auch die Backups bleiben auf europäischer
Infrastruktur.

**Das Bezahlen von Credits ist die eine Ausnahme – und nur, wenn du es tust.**
Wenn du Credits kaufst, wird die Zahlung über **Stripe** abgewickelt: Du gibst
deine Karten- oder TWINT-Daten auf Stripes eigener Seite ein, nicht auf dieser,
und Stripe verarbeitet sie auf eigenen Systemen, die ausserhalb dieses Servers
und möglicherweise ausserhalb Europas liegen. Der Betrag und die
E-Mail-Adresse, an die die Quittung geht, werden für diese Zahlung an Stripe
weitergegeben; sonst nichts über dein Journal. Wenn du nie Credits kaufst, ist
Stripe nie beteiligt. Was Stripe mit den Zahlungsdaten macht, regelt
[Stripes Datenschutzerklärung](https://stripe.com/privacy).

## Tracking, und das wenige davon

Es gibt auf dieser Seite **kein Analytics von Dritten**. Kein Google Analytics,
kein Plausible, kein Matomo, keine Zählpixel, kein Werbenetzwerk, keine
Schriften oder Skripte von fremden Servern. Nichts auf diesen Seiten wird von
einem fremden Server geladen, und nichts meldet deinen Besuch irgendwohin
ausser an diesen einen.

Wer ein Journal führt, kann für das eigene Journal eine **Besuchszählung**
einschalten. Sie ist aus, solange das nicht geschehen ist. Ist sie an, hält
dieser Server fest, dass eine Seite geöffnet wurde — welches Journal, welche
Reise, welcher Tag, und wann —, damit jemand, der ein Reisetagebuch schreibt,
sehen kann, ob die Menschen, denen er es geschickt hat, es auch lesen.

**Du wirst dabei nicht identifiziert, und du kannst nicht verfolgt werden.** Es
gibt dafür kein Cookie, kein Skript in deinem Browser und keinen
Geräte-Fingerabdruck. Um zwei Lesende am selben Tag auseinanderzuhalten, bildet
der Server einen kurzen Code aus deiner Internetadresse und dem Namen deines
Browsers, vermischt mit einem Geheimnis, das zufällig erzeugt wird, nur im
Arbeitsspeicher liegt und jeden Tag verworfen wird. Deine IP-Adresse selbst
wird nie gespeichert. Ist das Geheimnis des Tages weg, lassen sich die Codes
niemandem mehr zuordnen, und sie lassen sich auch nicht mit denen des nächsten
Tages abgleichen — dieselbe Person gilt morgen also als jemand Neues, und es
gibt bewusst keine Möglichkeit, ein Bild einzelner Lesender über die Zeit
aufzubauen.

Nicht festgehalten werden: deine IP-Adresse, dein Browser, dein Betriebssystem,
dein Land oder deine Stadt, und die Seite, von der du gekommen bist. Einiges
davon ist in der Webanalyse üblich; das Letzte fehlt mit Absicht, denn es würde
festhalten, wo ein privater Link herumgereicht wurde.

Diese Einträge werden nach etwa neunzig Tagen gelöscht.

Cookies werden ausschliesslich für die Anmeldung gesetzt — eine Sitzung oder
eine Identität, die deine E-Mail-Adresse gegenüber der Seite bestätigt. Ein
Cookie-Banner gibt es weiterhin nicht: nichts vom oben Beschriebenen wird auf
deinem Gerät gespeichert oder von dort gelesen, es gibt also nichts
einzuwilligen.

Der Webserver führt ausserdem gewöhnliche Zugriffslogs (IP-Adresse, Zeit,
aufgerufene Seite) für kurze Zeit — das braucht ein Server, um überhaupt
betrieben und verteidigt werden zu können.

## Was gespeichert wird, und wofür

- **Journalinhalte** — die Texte, Fotos und Daten, die ihre Autorinnen und
  Autoren schreiben.
- **E-Mail-Adressen** — der Journalbesitzerin, der Menschen auf einer Reise
  und eingeladener Leserinnen. Die Adresse *ist* hier der Zugang: es gibt
  keine Passwörter, die Anmeldung läuft über einen Code an diese Adresse.
- **Sitzungen und Agenten-Tokens** — damit ein Browser angemeldet bleibt und
  ein Agent sieben Tage lang schreiben kann. Für die eigene Person einsehbar
  und jederzeit widerrufbar.
- **Push-Abos**, wenn du ein Journal gebeten hast, dein Gerät zu benachrichtigen.
- **Telefonnummern und Postadressen**, nur von Leserinnen und Lesern, die eine
  angegeben haben, um eine WhatsApp-Nachricht oder eine gedruckte Postkarte zu
  bekommen. Postadressen werden verschlüsselt gespeichert und sind für einen
  Agenten nie sichtbar.
- **Kopien der von dieser Seite versendeten E-Mails**, beim jeweiligen Journal.
- **Gespräche mit dem Helfer** — was eine Besitzerin ihm geschrieben oder
  gesagt hat, was er geantwortet hat, und was er damit getan hat: welche
  Werkzeuge er aufgerufen hat, was er vorgeschlagen hat, und ob der Vorschlag
  angenommen wurde. Sie werden gespeichert, damit man ein altes Gespräch
  wieder öffnen und dort weitermachen kann, wo man aufgehört hat — dafür sind
  sie da. **Mit dem Helfer spricht nur die Besitzerin eines Journals** — im
  Web, weil dafür eine Anmeldung nötig ist, und über WhatsApp, weil dort nur
  eine Telefonnummer an ein Journal gebunden wird, die dessen Besitzerin
  zuvor bereits bestätigt hat. Eine Nachricht von jeder anderen Nummer erhält
  eine einzige feste Antwort, die ablehnt zu helfen, samt einem Link zur
  Anmeldung, und erreicht das Modell nie — ein Gespräch enthält also weiterhin
  die Worte einer einzigen Person. **Wir lesen sie, um zu sehen, was besser
  werden muss, und eine Besitzerin kann das ausschalten** — auf ihrer eigenen
  Seite, jederzeit. Das Ausschalten löscht nichts; es heisst, dass ausser ihr
  niemand liest, was da ist oder noch kommt.
- **Nachrichten, Fotos, Dokumente und Sprachnachrichten per WhatsApp** — die
  eigenen Worte und Medien einer Besitzerin, sobald ihre Nummer gebunden ist.
  Ein Foto oder Dokument liegt unveröffentlicht im Posteingang des Journals,
  bis ein Tag es beansprucht oder es verworfen wird. Eine Sprachnachricht wird
  vom unten genannten Transkriptionsdienst in Text umgewandelt, und dieser
  Text bleibt beim Gespräch erhalten; die Aufnahme selbst wird nie auf diesem
  Server gespeichert — siehe „Die Sprachaufnahme wird nirgends gespeichert"
  weiter unten, was für eine WhatsApp-Sprachnachricht ebenso gilt wie für eine,
  die dem Helfer im Web gesagt wird. **Schicke nur, wozu du berechtigt bist** —
  ein Foto mit einer weiteren Person darauf oder ein Dokument mit dem Namen
  einer weiteren Person wurde nie um deren Einwilligung gefragt, und weder
  diese Seite noch die Software kann sie an deren Stelle geben.
- **Aufrufzahlen**, bei Journalen, deren Autorin die Besuchszählung
  eingeschaltet hat: welche Seite, wann, und der oben beschriebene Tagescode.
  Nichts, was eine Leserin benennt, und nach etwa neunzig Tagen gelöscht.

Du kannst die Besitzerin eines Journals bitten, dich daraus zu entfernen, und
eine Besitzerin kann ein ganzes Journal löschen — diese Löschung ist echt und
nimmt Inhalte wie Datenbankzeilen mit.

## Externe Dienste

Alles Folgende ist **aus, solange ein Journal es nicht einschaltet**, und wird
nur für den genannten Zweck genutzt. Nichts davon bekommt Daten zur Auswertung,
für Werbung oder zur Profilbildung.

| Dienst | Wann | Was er bekommt |
| --- | --- | --- |
| **Meta Platforms Ireland** (WhatsApp Cloud API) | Eine Leserin möchte per WhatsApp von neuen Tagen hören | Ihre Telefonnummer und die Nachricht |
| **Meta Platforms Ireland** (WhatsApp Cloud API) | Die bereits bestätigte eigene Nummer einer Besitzerin schreibt an die WhatsApp-Nummer des Journals | Ihre Telefonnummer; den Text, das Foto, das Dokument oder die Sprachaufnahme, die sie geschickt hat; und, getrennt vom Nachrichteninhalt, jene Kontodaten der WhatsApp Business Platform, die Meta zu eigenen Zwecken der Plattformsicherheit und Betrugserkennung hält |
| **Stannp Ltd** (Grossbritannien) | Jemand bestellt eine gedruckte Postkarte | Das Foto, den Text und die Postadresse der Empfängerin |
| **Gelato ASA** (Norwegen) | Jemand bestellt ein gedrucktes Fotobuch | Das PDF des Buchs und die Lieferadresse |
| **Proton AG** (Schweiz) | Anmeldecodes, Einladungen, Benachrichtigungen | Die Empfängeradresse und die Nachricht |
| **Anthropic PBC** (USA) | Jemand nutzt die Schreibhilfe — unter `/agent` im Web oder über WhatsApp — um einen Tag schreiben zu lassen, Fotos beschriften zu lassen oder einen getippten oder gesprochenen Satz verstehen zu lassen | Was die Person getippt oder gesagt hat; die Angaben, die ihr eigener Tag ohnehin trägt (Datum, Ort, Land sowie Anzahl und Zeitspanne der Fotos); und für Bildunterschriften die Fotos selbst |
| **Deepgram Inc.** (USA) | Jemand spricht mit der Schreibhilfe, statt zu tippen — im Web, oder mit einer Sprachnachricht über WhatsApp | Die Aufnahme der Stimme und die Sprache, in der sie ist |
| **Open-Meteo** (Deutschland) | Ein Journal hat gefragt, wie das Wetter an einem festgehaltenen Tag war | Die Koordinaten und das Datum dieses Tages — nichts über Sie |
| **Europäische Zentralbank** (Deutschland) | Eine Reise brauchte den Wechselkurs für eine Währung, in der sie ausgegeben hat | Gar nichts — abgerufen wird ein veröffentlichtes Dokument, und es transportiert keine Frage |

Das ist die vollständige Liste. Mehr ist da nicht.

**Meta übernimmt zwei verschiedene Rollen, und die gehören getrennt.** Für die
oben genannten Nachrichteninhalte — Text, Foto, Dokument oder Sprachaufnahme —
handelt Meta Platforms Ireland als **Auftragsverarbeiterin** im Auftrag dieses
Journals und erklärt, dass Cloud-API-Nachrichten nicht zur Werbeausspielung
genutzt werden. Getrennt davon, und in eigener Verantwortung, handelt Meta als
**eigenständige Verantwortliche** für Plattformsicherheit, Integrität und
Betrugserkennung auf der WhatsApp Business Platform; das ist Metas eigenes
Verhältnis zu dir als WhatsApp-Nutzerin, nicht das dieses Journals, und
[WhatsApps eigene Datenschutzrichtlinie](https://www.whatsapp.com/legal/privacy-policy)
beschreibt es. Wer die Cloud API überhaupt nutzt, akzeptiert damit Metas
**WhatsApp Business Terms of Service**, ihre **Business Data Processing
Terms** und das **Business Data Transfer Addendum** — hier beim Namen
genannt statt als „geprüft" behauptet, denn es handelt sich um
Standardbedingungen per Klick-Zustimmung, die bei der Einrichtung einer
WhatsApp-Business-Nummer akzeptiert werden, nicht um einen ausgehandelten
Vertrag dieses Betreibers. Die Übermittlung in die USA, die sowohl Meta als
auch Anthropic betrifft, ist über das **Swiss–US Data Privacy Framework**
abgedeckt. Wer die API der Schreibhilfe nutzt, akzeptiert ebenso Anthropics
**kommerzielle Geschäftsbedingungen**, die eine eigene
Auftragsverarbeitungsvereinbarung per Verweis mit einschliessen; auch diese
Zustimmung wird hier beim Namen genannt und nicht als geprüft dargestellt —
eine Standardvereinbarung, akzeptiert bei der Einrichtung des Kontos, nicht
eigens für dieses Journal ausgehandelt oder geprüft. Deepgrams
Verarbeitungsbedingungen sind nicht in derselben Weise per Klick zu
akzeptieren, und ob eine Vereinbarung für diese Instanz besteht, wird ehrlich
gesagt: nein, noch nicht — eine Anfrage dazu ist bei Deepgrams eigener
Datenschutzstelle bereits gestellt.

**Diese Zeilen tragen eine Bedingung, die die anderen nicht haben, und
sie gehört ausgesprochen: Zu Anthropic und zu Deepgram geht nichts, solange
niemand die Schreibhilfe benutzt — im Web oder über WhatsApp.** Ein Journal zu
lesen löst nichts aus. Ein Journal mit dem eigenen Agenten zu schreiben löst
nichts aus. Wer seine Tage selbst tippt, verursacht keine einzige Anfrage an
eine der beiden Firmen, und eine Leserin kann überhaupt keine auslösen — auch
nicht jemand Fremdes, der die WhatsApp-Nummer des Journals anschreibt: diese
Nachricht erhält eine einzige feste Antwort und erreicht das Modell nie (siehe
„Mit dem Helfer spricht nur die Besitzerin eines Journals" weiter oben).

Gesendet wird, was die Person der Schreibhilfe vorgelegt hat, und die wenigen
Angaben, die ihr eigener Tag ohnehin trägt — dieselben, die währenddessen auf
ihrem Bildschirm stehen. **Kein Standortverlauf, keine Kontakte, keine
E-Mail-Adressen und keine Postadressen gehen an eine der beiden, niemals.** Der
Standortverlauf eines Journals — wo es einen führt — liegt in einem Ordner, den
keine Anfrage erreicht, und er gehört nicht zu den Angaben, die die
Schreibhilfe bekommt.

**Die Sprachaufnahme wird nirgends gespeichert.** Wie auch immer sie
ankommt — dem Helfer im Web gesagt, oder als Sprachnachricht über WhatsApp
geschickt — geht sie mit einer Anfrage an den Transkriptionsdienst und wird
mit dem Ende der Anfrage verworfen — keine Kopie auf diesem Server, keine im
Backup, keine im Export eines Journals. Erhalten bleibt der Text, denn der Text ist das, worum gebeten
wurde. Eine Instanz ohne eingerichteten Transkriptionsdienst schickt die
Aufnahme gar nicht erst weg — nichts verlässt die Maschine, und keine Firma
hört sie.

Beide werden nur für die eine angefragte Aufgabe genutzt. Keiner von beiden
bekommt etwas zur Auswertung, für Werbung oder zur Profilbildung, und keiner
wird gebeten, nach der Antwort noch etwas aufzubewahren.

Die Wetterzeile unterscheidet sich von allen Zeilen darüber, und der Unterschied
gehört ausgesprochen: **diese Anfrage stellt dieser Server, nicht Ihr
Browser.** Sie wird einmal gesendet, wenn ein Tag geschrieben wird, und was
zurückkommt, steht danach in der Datei dieses Tages — eine Seite mit
Wetterangaben aufzurufen sendet also an niemanden etwas. Open-Meteo sieht Ihre
Adresse nie, und keine Anfrage enthält etwas, das eine Person identifiziert.
Die Koordinaten sind die, die der Autor selbst auf seinen Tag geschrieben hat.

Wetterdaten von [Open-Meteo.com](https://open-meteo.com/), genutzt unter der
[Lizenz Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/deed.de).
Diese Lizenz verlangt drei Dinge, und das hier sind alle: Nennung der Quelle,
ein Link auf die Lizenz und ein Hinweis auf Änderungen. **Die Änderungen sind,
dass Werte gerundet werden** — Temperaturen auf ganze Grad, Niederschlag auf
eine Nachkommastelle, so wie sie an einem Tag stehen — und dass der numerische
Wettercode von Open-Meteo als eines von sieben Bildern gezeichnet statt
ausgeschrieben wird. Die ungerundeten Werte bleiben in der Datei des Tages.

Open-Meteo ist selbst nur die Vorderseite der nationalen Wetterdienste —
MeteoSchweiz, DWD, ECMWF, NOAA, Météo-France, JMA und weitere, jeder unter
seiner eigenen offenen Lizenz, alle aufgeführt auf
[deren Lizenzseite](https://open-meteo.com/en/licence). Das Wetter eines Tages
geht hier also auf ein öffentliches meteorologisches Amt zurück und nicht auf
ein Unternehmen, das Prognosen verkauft.

**Ein selbst notierter Messwert ist nichts davon.** An manchen Tagen steht eine
Temperatur, die jemand dort aufgeschrieben hat, wo er stand, statt einer, die
dieser Server abgefragt hat. Diese nennen, wer sie gemessen hat, und werden
niemandem sonst zugeschrieben — an so einem Tag steht kein Open-Meteo-Link,
weil an ihm keine Open-Meteo-Daten stehen.

**Beim Geld ist es dasselbe wie beim Wetter, und die letzte Zeile erhält noch
weniger.** Eine Reise hält fest, was in welcher Währung ausgegeben wurde; um
das in einer anderen Währung zu zeigen, braucht es einen Kurs. Diese Kurse
kommen von den veröffentlichten Euro-Referenzkursen der Europäischen
Zentralbank: die Tagestabelle für die Umrechnung in die Währung, die Sie oben
auf einer Kostenseite wählen, und — für den Kurs, mit dem eine Reise dauerhaft
gerechnet wird — die 90-Tage-Historie der EZB, einmal gelesen für den Tag, an
dem eine Währung auf dieser Reise zum ersten Mal vorkommt, und dann in der
Datei der Reise festgeschrieben. **Beide Anfragen stellt dieser Server, und
beide holen ein vollständiges öffentliches Dokument.** Die EZB erfährt weder,
um welche Reise, noch um welche Währung, noch um welches Datum es geht, und
Ihr Browser spricht überhaupt nie mit ihr.

Wechselkurse von der [Europäischen Zentralbank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html),
deren Referenzkurse mit Quellenangabe wiedergegeben werden dürfen — dieser
Absatz und die Angabe auf der Kostenseite sind genau das. **Verändert wurde
Folgendes: die EZB notiert jede Währung gegen den Euro, ein Journal nicht** —
ein Kurs hier ist also auf die Basiswährung des Journals umgerechnet und auf
sechs Stellen gerundet. Eine Kostenseite, die einen nachgeschlagenen Kurs
verwendet, nennt unter den Summen die EZB und das verwendete Datum.

**Ein selbst eingetragener Kurs ist nichts davon** und trägt keine
Quellenangabe, weil es nichts zu nennen gibt außer der Person, die ihn
geschrieben hat — etwa den Kurs, den die Karte tatsächlich abgerechnet hat und
den kein Referenzkurs kennt. Wo es für eine Währung gar keinen Kurs gibt,
steht die Ausgabe so da, wie sie bezahlt wurde, und bleibt aus den Summen
heraus, statt zu einer Zahl umgerechnet zu werden, für die niemand geradesteht.

Die E-Mails dieser Seite laufen über **Proton Mail in der Schweiz** —
verschlüsselt gespeichert und unter Schweizer Datenschutzrecht, statt über
einen Anbieter, der Post mitliest, um daran zu verdienen. Sobald eine
Nachricht an eine Adresse geht, die nicht selbst bei Proton liegt, ist sie
gewöhnliche E-Mail — gut zu wissen, bevor jemand etwas Heikles in eine
Antwort schreibt.

## Deine Rechte

Nach DSGVO und Schweizer DSG kannst du Auskunft verlangen, Berichtigung
verlangen und Löschung verlangen. Schreib an die Adresse oben auf dieser
Seite. Dort liest ein einzelner Mensch mit, also etwas Geduld bitte.

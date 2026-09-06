## Wer das hier betreibt

Fernscout ist ein **Hobbyprojekt** von Severin Lindenmann, Schweiz. Es ist
keine Firma, es gibt keinen Support und keine zugesicherte Verfügbarkeit.

Kontakt: <agent@fernscout.ch>

Die Software ist Open Source unter der AGPL-3.0 und vollständig einsehbar auf
[github.com/severinlindenmann/fernscout](https://github.com/severinlindenmann/fernscout).

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

## Kein Tracking

Auf dieser Seite gibt es **keinerlei Analytics**. Kein Google Analytics, kein
Plausible, kein Matomo, keine Zählpixel, kein Werbenetzwerk, kein
Fingerprinting, keine Schriften oder Skripte von fremden Servern. Nichts auf
diesen Seiten meldet deinen Besuch irgendwohin.

Cookies werden ausschliesslich für die Anmeldung gesetzt — eine Sitzung oder
eine Identität, die deine E-Mail-Adresse gegenüber der Seite bestätigt. Es
gibt kein Cookie-Banner, weil es nichts einzuwilligen gibt.

Der Webserver führt gewöhnliche Zugriffslogs (IP-Adresse, Zeit, aufgerufene
Seite) für kurze Zeit — das braucht ein Server, um überhaupt betrieben und
verteidigt werden zu können.

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
| **Stannp Ltd** (Grossbritannien) | Jemand bestellt eine gedruckte Postkarte | Das Foto, den Text und die Postadresse der Empfängerin |
| **Gelato ASA** (Norwegen) | Jemand bestellt ein gedrucktes Fotobuch | Das PDF des Buchs und die Lieferadresse |
| **Proton AG** (Schweiz) | Anmeldecodes, Einladungen, Benachrichtigungen | Die Empfängeradresse und die Nachricht |
| **Open-Meteo** (Deutschland) | Ein Journal hat gefragt, wie das Wetter an einem festgehaltenen Tag war | Die Koordinaten und das Datum dieses Tages — nichts über Sie |

Das ist die vollständige Liste. Mehr ist da nicht.

Die Wetterzeile unterscheidet sich von den vier darüber, und der Unterschied
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

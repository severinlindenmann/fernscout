Jede Reise auf dieser Seite kann den tatsächlich zurückgelegten Weg zeichnen,
nicht nur eine gerade Linie zwischen zwei Tagen. Das stammt aus dem
Standortverlauf deines Telefons, und diese Seite ist die genaue Regel, nach
der diese Software damit umgeht — kein Versprechen, sondern eine Beschreibung
des Codes.

## Was aufgezeichnet wird

Wenn du in der iPhone-App die **Routenaufzeichnung** einschaltest, protokolliert
dein Telefon im Hintergrund seine eigene Position, ausgedünnt auf etwa einen
Punkt alle fünf Minuten oder 250 Meter — genug, um eine Straße zu zeichnen,
aber nicht genug, um ein die ganze Nacht auf dem Nachttisch liegendes Telefon
zu protokollieren.

Du kannst auch einen bereits vorhandenen Standortverlauf **importieren** — einen
Google-Timeline- oder Takeout-Export, eine GPX-Datei oder den Export deines
eigenen Werkzeugs — anstelle der Aufzeichnung oder zusätzlich dazu. So oder so
werden die Punkte auf dieselbe Weise ausgedünnt und an einem Ort aufbewahrt:
deinem eigenen Verlauf, in deinem eigenen Reisetagebuch.

## Was veröffentlicht wird

**Nur eine abgeleitete Linie, und nur das, was ein:e Leser:in gerade sehen
darf.** Die öffentliche Karte einer Reise spielt nie deinen rohen Verlauf ab
— sie zeichnet `track.json`, eine Linie, die einmal aus deinem Verlauf gebaut
und bei jedem Seitenaufruf neu daran geprüft wird, was genau diese:r Leser:in
gerade sehen darf: Sie ist auf die Kalendertage beschränkt, für die diese:r
Leser:in einen veröffentlichten Eintrag sieht, und sie zeichnet nie etwas aus
den letzten 24 Stunden, egal was das Datum eines Tages behauptet. Ein noch
nicht veröffentlichter Tag oder ein Stück Weg von heute Nachmittag steht auf
keiner Karte — für niemanden, auch nicht für dich, wenn du sie als Gast
liest.

Die beiden Enden jedes Wegstücks werden zusätzlich um 500 Meter gekürzt, weil
das meist eine Haustür ist, und jeder von dir als privat markierte Ort
(siehe unten) wird entfernt; die Linie bricht dort ab, statt darüber
hinwegzulaufen.

## Was dein eigenes Verzeichnis nie verlässt

**Dein roher Standortverlauf wird niemals veröffentlicht, unter keiner
Einstellung.** Es gibt keine Seite, keinen API-Aufruf und keinen Export, der
auch nur eine einzige Position daraus zurückgibt — das Einzige, was jemals
daraus ausgeliefert wird, ist die oben beschriebene gekürzte Linie. Löschst du
deinen Verlauf vollständig, zeichnen sich alle deine veröffentlichten Reisen
genau so wie zuvor: Nichts auf der öffentlichen Seite hängt davon ab, dass die
rohe Datei noch da ist.

## Orte, die du als privat markierst

Du kannst einen Ort — dein Zuhause, jeden Ort, in dessen Nähe du nie eine
Linie sehen möchtest — mit einer Adresse und einem Radius markieren. Jeder
Punkt darin wird entfernt, bevor überhaupt eine Linie aus deinem Verlauf
gezeichnet wird, für jeden Zweck, auch für die beiden Ausnahmen unten. Eine
unlesbare Liste dieser Orte wird behandelt, als sei "alles privat" statt
"nichts privat" — diese Software zeigt dir lieber eine kürzere Linie als eine
falsche.

## Die zwei Ausnahmen, und nur diese zwei

Zwei Bildschirme, und nur diese zwei, lesen jemals direkt deinen rohen
Verlauf, und beide funktionieren nur, während du in deinem eigenen
Browser in dein eigenes Reisetagebuch eingeloggt bist — nie über einen
Agenten, nie über einen Link, nie über irgendetwas, das ein Zugriffstoken
hält:

- **Ein Vorschlag, wo ein neuer Tag stattgefunden hat.** Beim Anlegen eines
  neuen Tages kann dir die Stadt vorgeschlagen werden, in der du an diesem
  Tag vermutlich warst, ermittelt aus deinem eigenen Verlauf und benannt
  durch eine Offline-Suche, die diese Software selbst ausführt — nie an ein
  anderes Unternehmen geschickt. Sie liefert einen Ortsnamen zurück, nie
  eine Position.
- **Deine eigene Route, auf deiner eigenen Standortseite.** Die Seite, auf
  der du das alles verwaltest, zeigt dir auch deine eigene Aufzeichnung,
  ungefiltert von den 24-Stunden- oder Privatort-Regeln oben — weil der
  Blick auf deinen eigenen Verlauf nicht das ist, wovor diese Regeln dich
  schützen sollen.

Beide sind ausgeschaltet, sofern der Betreiber dieser Instanz die
Routenaufzeichnung nicht aktiviert hat, und keine der beiden ist über etwas
erreichbar, das in deinem Namen handelt statt als du selbst.

## Exportieren oder löschen

Dein roher Verlauf ist Teil deines **eigenen Dateisystem-Backups**, weil er
dir gehört — er wird aber bewusst aus jedem Download ausgelassen, den diese
Seite für eine Reise, ein Reisetagebuch oder einen geteilten Link erzeugt,
denn keiner davon sollte je mit einer Position darin herausgehen können.

Löschen ist echtes, sofortiges Löschen, keine Anfrage, auf die jemand
wartet: Auf der Standortseite deines Reisetagebuchs kannst du die Aufzeichnung
einer Reise, eines einzelnen Tages oder deinen ganzen Verlauf entfernen,
monatsweise oder alles auf einmal. Sobald du bestätigst, sind die Punkte weg
und die betroffenen Kartenlinien werden ohne sie neu gezeichnet.

## Warum diese Seite existiert

Im September 2026 berichtete das Recherchemedium Follow the Money, dass eine
bekannte Reisetagebuch-App rund 230 Millionen Fotos und eine Milliarde
Standortpunkte über eine API offengelegt hatte, die keinerlei Anmeldung
verlangte — darunter auch Heimatadressen. Quelle:
<https://www.ftm.eu/articles/travel-app-polarsteps-military-sensitive-data-leaked>.

Diese Seite ist kein Vergleich mit dieser App — sie beschreibt, was diese
Software tatsächlich mit deiner Position macht, in denselben klaren Worten,
damit du keiner der beiden Behauptungen einfach glauben musst.

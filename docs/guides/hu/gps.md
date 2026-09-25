Ezen az oldalon minden utazás a ténylegesen megtett utat tudja megrajzolni,
nem csupán egy egyenes vonalat két nap között. Ez a telefonod
helyadat-előzményéből származik, és ez az oldal a pontos szabály, amelyet ez
a szoftver ezzel követ — nem ígéret, hanem a kód leírása.

## Mi kerül rögzítésre

Ha bekapcsolod az **útvonal-rögzítést** az iPhone-alkalmazásban, a telefonod a
háttérben rögzíti a saját pozícióját, körülbelül ötpercenként vagy 250
méterenként egy pontra ritkítva — ez elég egy útvonal megrajzolásához, de nem
elég ahhoz, hogy egy egész éjszaka az éjjeliszekrényen fekvő telefont
naplózzon.

Egy már meglévő helyadat-előzményt is **importálhatsz** — egy Google
Timeline- vagy Takeout-exportot, egy GPX-fájlt, vagy a saját eszközöd
exportját — a rögzítés helyett vagy mellett. Bármelyik esetben a pontok
ugyanúgy ritkulnak, és egyetlen helyen maradnak: a saját előzményedben, a
saját naplódban.

## Mi kerül nyilvánosságra

**Csak egy levezetett vonal, és csak az, amit az olvasó éppen láthat.** Egy
utazás nyilvános térképe soha nem játssza le a nyers előzményedet — a
`track.json`-t rajzolja, egy vonalat, amelyet egyszer az előzményedből
építettek, és minden oldalbetöltéskor újra ellenőriznek aszerint, hogy az
adott olvasó éppen mit láthat: azokra a naptári napokra korlátozódik,
amelyekhez az olvasónak közzétett bejegyzése van, és soha nem rajzol semmit
az elmúlt 24 órából, bármit is állít egy nap saját dátuma. Egy még
közzé nem tett nap, vagy egy útszakasz a délutánból, senki térképén nem
jelenik meg — még a tiéden sem, ha vendégként olvasod.

Minden útszakasz mindkét vége további 500 méterrel rövidül, mert az
általában egy bejárati ajtó, és minden általad privátnak jelölt hely
(lásd lent) el lesz távolítva; a vonal ott megszakad, ahelyett hogy
átívelne rajta.

## Ami sosem hagyja el a saját mappádat

**A nyers helyadat-előzményed soha nem kerül nyilvánosságra, semmilyen
beállítás mellett.** Nincs olyan oldal, API-hívás vagy export, amely akár
egyetlen pozíciót is visszaadna belőle — az egyetlen dolog, amit valaha
kiszolgálnak belőle, a fent leírt, levágott vonal. Ha teljesen törlöd az
előzményedet, minden általad közzétett utazás pontosan úgy jelenik meg,
mint korábban: az oldal nyilvános részén semmi nem függ attól, hogy a nyers
fájl még megvan-e.

## Helyek, amelyeket privátnak jelölsz

Megjelölhetsz egy helyet — az otthonodat, bármit, aminek közelében sosem
szeretnél vonalat látni — egy címmel és egy sugárral. Minden ezen belüli
pont eltávolításra kerül, mielőtt egyáltalán vonalat rajzolnának az
előzményedből, bármilyen célra, beleértve a lenti két kivételt is. Egy
olvashatatlan lista ezekről a helyekről úgy kezelendő, mintha "minden
privát" lenne, nem úgy, mintha "semmi sem privát" — ez a szoftver inkább
egy rövidebb vonalat mutat neked, mint egy hibásat.

## A két kivétel, és csakis ez a kettő

Két képernyő, és csakis ez a kettő, olvassa valaha közvetlenül a nyers
előzményedet, és mindkettő csak akkor működik, amíg a saját böngésződben,
saját naplódba vagy bejelentkezve vagy — soha ügynökön keresztül, soha
linken keresztül, soha semmi olyanon keresztül, ami tokent tart a kezében:

- **Javaslat arra, hol történt egy új nap.** Egy új nap kezdésekor
  felajánlható a leginkább valószínű város, ahol aznap voltál, a saját
  előzményedből kiszámítva, és egy offline keresés nevezi meg — amelyet ez a
  szoftver maga futtat, soha nem küldi el másik cégnek. Helynevet ad vissza,
  soha nem pozíciót.
- **A saját útvonalad, a saját helyszínoldaladon.** Az az oldal, ahol mindezt
  kezeled, megmutatja a saját rögzítésedet is, a fenti 24 órás vagy privát
  hely szabályok nélkül szűrve — mert a saját előzményed megtekintése nem az,
  amitől ezek a szabályok védeni próbálnak.

Mindkettő ki van kapcsolva, hacsak az ezt a példányt üzemeltető nem
kapcsolta be az útvonal-rögzítést, és egyik sem érhető el semmi olyanon
keresztül, ami a nevedben jár el ahelyett, hogy te magad lennél.

## Exportálás vagy törlés

A nyers előzményed a saját **fájlrendszer-mentésed** része, mert a tiéd — de
szándékosan kimarad minden letöltésből, amit ez az oldal egy utazáshoz, egy
naplóhoz vagy egy megosztott linkhez készít, mert egyik sem hagyhatja el a
rendszert egy pozícióval a belsejében.

A törlés valódi, azonnali törlés, nem egy kérés, amire valaki vár: a
naplód helyszínoldalán eltávolíthatod egy utazás rögzítését, egy napét,
vagy a teljes előzményedet, havonta vagy egyszerre mindet. Amint
megerősíted, a pontok eltűnnek, és az érintett térképvonalak újrarajzolódnak
nélkülük.

## Miért létezik ez az oldal

2026 szeptemberében a Follow the Money oknyomozó portál arról számolt be,
hogy egy ismert utazási napló alkalmazás körülbelül 230 millió fényképet és
egymilliárd helyadat-pontot tárt fel egy olyan API-n keresztül, amely
semmiféle bejelentkezést nem igényelt — köztük otthoni címeket is. Forrás:
<https://www.ftm.eu/articles/travel-app-polarsteps-military-sensitive-data-leaked>.

Ez az oldal nem összehasonlítás azzal az alkalmazással — hanem leírja, mit
tesz ez a szoftver ténylegesen a pozícióddal, ugyanazokkal az egyszerű
szavakkal, hogy egyik állítást se kelljen csak úgy elhinned.

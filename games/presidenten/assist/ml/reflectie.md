# Reflectie: adaptieve hulp in Presidenten (Lab 8, optie B), concept

## Wat het systeem doet

De hulplaag in Presidenten past zich aan aan wie er speelt. Een zelfgebouwd
contextgeheugen (`context.ts`) houdt per speler (per bijnaam, in de
`localStorage` van de browser) elke gespeelde ronde bij: tijdstip, sessie,
eindrol en of er hulp actief was. Daaruit haalt `features.ts` vier lagen
context:

- **lange termijn**: winstpercentage en aantal keer Scum in de laatste 20 rondes
- **sessie**: verliesreeks, aantal rondes en minuten in deze sessie.
  "Verlies" betekent hier "niet gewonnen": aan een tafel van vier wint alleen
  de President, dus de reeks telt in feite de rondes sinds je voor het laatst
  President was.
- **omgeving**: uur van de dag (als sin/cos, zodat 23:00 naast 00:00 ligt)
- **spelsituatie**: sterkte van de hand na de ruil (2 = 3, A = 2, K = 1 punt,
  omgerekend naar een hand van 13 kaarten). Bij de ruil vraagt de President
  de Scum om een rang (meestal een sterke) en geeft zelf een kaart naar keuze
  terug. Wie vorige ronde Scum was, begint daardoor vaak zwakker.

Een **logistische regressie** voorspelt daarmee P(scum), de kans dat de
speler deze ronde als laatste eindigt. Twee drempels bepalen het hulpniveau:
onder T1 geen hulp, vanaf T1 de beste zet gemarkeerd, vanaf T2 ook een korte
uitleg. In de run hieronder is T1 = 0,351 en T2 = 0,532. De drempels zijn
het 70e en 90e percentiel van de voorspelde kansen op de testset, dus
ongeveer 30% van de rondes krijgt hulp en 10% de uitleg. Het niveau ligt vast
zodra het spelen begint (na de ruil). Zo flikkert de hulp niet aan en uit en
past de beslissing bij de informatie waarop het model getraind is. Wie
midden in een hand de pagina herlaadt, krijgt een voorspelling met een
gemiddelde hand.

Het model is alleen getraind op tafels van vier. Bij een andere tafelgrootte
schuift de *getoonde* kans naar het basispercentage van die tafel (1/n). Het
*niveau* blijft bepaald op de schaal van vier spelers. Anders zou een
gemiddelde speler aan een tafel van drie (kans 1/3) al hulp krijgen omdat hij
daar zit.

Dat context het gedrag verandert, laat de A/B-demo zien (`simulate.ts --ab`).
Bij dezelfde hand en dezelfde tafel krijgt een speler met een zwakke
geschiedenis P(scum) = 0,75 (niveau 2: markering en uitleg). Een speler met
een sterke geschiedenis krijgt P = 0,06 (geen hulp). Een nieuwe speler krijgt
0,21 (geen hulp). Met de contextschakelaar uit krijgt iedereen het
basispercentage van de tafel (0,25 bij vier spelers). Dat ligt onder T1, dus
krijgt iedereen niveau 0: geen hulp. In één run van de leercurve-simulatie
neemt de hulp af naarmate de speler beter wordt: van 7% van de rondes in het
eerste derde deel, via 1%, naar 0% in het laatste derde deel.

**Niet alles is geleerd.** Welke zet wordt gemarkeerd, bepaalt een
regelgebaseerde adviseur (`advisor.ts`): lage kaarten eerst, paren bij elkaar
houden, 2'en sparen. Alleen de vraag *hoeveel* hulp iemand krijgt, beantwoordt
het getrainde model.

## Resultaten en eerlijkheid over de data

Het model is getraind op **gesimuleerde** spellen. Er zijn geen echte
spelers gebruikt. 48 bots (zwak, gemiddeld, sterk, met spreiding per bot)
speelden met de echte spelregels ruim 6000 handen in wisselende kamers,
samen 24.144 rijen. Daar zitten **bewust ingebouwde effecten** in: 's nachts,
na een lange sessie en tijdens een verliesreeks maken bots vaker een slordige
zet, en zwakke bots het vaakst. Het model kan die effecten dus alleen
terugvinden. Over echte mensen zegt het niets.

De simulatie speelt helemaal zonder hulp. Het trainingsscript gooit rondes
mét hulp weg, tegen de terugkoppellus, maar op deze data verwijdert dat
filter niets. Het is een vangnet voor later, als echte gelogde rondes worden
gebruikt.

Op spelers die het model nooit heeft gezien (de split is per speler, 9
testspelers):

- ROC-AUC **0,758** (een beslisboom met diepte 4 haalt 0,746)
- Brier-score 0,164 (altijd het basispercentage voorspellen geeft 0,197)
- de kalibratiecurve ligt dicht bij de diagonaal, dus "40%" betekent ook ongeveer 40%

De cijfers verschillen per run, omdat de handen met een echte
toevalsgenerator worden gedeeld en de testset klein is. T1 lag in
verschillende runs tussen 0,28 en 0,35.

Gestandaardiseerde coëfficiënten, in log-odds per standaardafwijking:

| kenmerk | coëfficiënt |
|---|---|
| winstpercentage (laatste 20) | −0,47 |
| aantal keer Scum (laatste 20) | +0,38 |
| verliesreeks | +0,25 |
| handsterkte | −0,23 |
| uur (sin / cos) | −0,05 / −0,01 |
| rondes in sessie / sessieminuten | +0,05 / +0,04 |

Het interessantste resultaat ging in tegen de verwachting. Ondanks het
ingebouwde nachteffect duwt het uur de kans 's nachts juist iets *omlaag*.
In de gevoeligheidsdemo daalt een zwakkere speler van 0,30 om 15:00 naar 0,27
om 02:00, en in een eerdere run zakte zo'n twijfelgeval om middernacht van
niveau 1 naar niveau 0. 's Nachts kan het systeem dus *minder* helpen. De
verklaring: aan een tafel van vier is er elke ronde precies één Scum en
iedereen deelt dezelfde klok, dus om 02:00 is het Scum-aandeel nog steeds
precies 25%. Het tijdstip zegt vooral iets over de **tegenstanders**: wie 's
nachts net begint, eindigt minder vaak onderaan (13,7% tegen 17,1% overdag),
omdat de anderen al uren spelen. Interactietermen uur × winstpercentage
hielpen niet (AUC 0,7578 → 0,7576). Ook de sessieduur valt grotendeels weg:
vermoeidheid leidt eerst tot verloren rondes, en die meet de verliesreeks al.
De sessielaag als geheel voegt wel iets toe (AUC 0,736 → 0,751).

Dit is ook een ontwerppunt. Een kenmerk kan redelijk klinken ("moe = meer
hulp") en in de praktijk het omgekeerde doen. Het uur zou je eigenlijk moeten
weglaten, of je moet context over de *andere* spelers toevoegen. Dat botst
met privacy, want hun geschiedenis staat in hun eigen browser.

## Hoe MCP dit systeem zou verbeteren

Nu zit alles in de spelcode: geheugen, kenmerken, model en uitleg. Met het
**Model Context Protocol** zou de spelserver een MCP-server kunnen worden die
context en acties op een gestandaardiseerde manier aanbiedt aan een
LLM-client.

**Resources** (alleen lezen, context):

- `player_profile`: winstpercentage, Scum-telling, sessiegegevens, hulpvoorkeuren
- `game_state`: de eigen `playerView` (eigen hand, tafel, beurt), nooit de handen van anderen
- `round_history`: de eerdere rondes van de speler (wat nu in `localStorage` staat)

**Tools** (acties):

- `get_legal_moves`: de geldige zetten, gerangschikt door de adviseur
- `predict_scum_risk`: P(scum) met de bijdragen per kenmerk (de huidige `computeHelp`)
- `get_player_stats`: samenvattingen voor uitleg en reflectie

Daarmee wordt een **LLM-coach** mogelijk die in gewone taal antwoordt op
vragen als "Waarom krijg ik hulp?" ("je kans om laatste te worden is 62%,
vooral door je verliesreeks van vijf rondes en je zwakke hand na de ruil")
of "Wat had ik beter kunnen doen?". De coach haalt die antwoorden met de tools
op en verzint niets. Nu toont het instellingenmenu alleen de kans, de drempel
en de drie kenmerken die de kans het meest *omhoog* duwen.

**Standaardisatie tegenover complexiteit.** Het voordeel van MCP is dat
dezelfde context- en toolbeschrijving voor elke client werkt (een andere coach,
een ander LLM, een dashboard voor de docent) zonder aparte koppelingen. Ook
moeten toegangsregels expliciet worden: wat mag een client lezen? Daar staat
complexiteit tegenover. Er komt een server bij, een protocol, authenticatie
per speler, en een LLM dat kosten en vertraging meebrengt. Voor de kern (één
getal dat het hulpniveau bepaalt) is dat overbodig: die draait nu lokaal in
een paar regels TypeScript. MCP loont pas voor de *uitleg- en coachlaag*,
niet voor de beslissing zelf.

## Ethiek

- **Eerlijkheid in multiplayer.** Hulp is een voordeel in een competitief
  spel. Daarom ziet alleen de speler zelf zijn hulp (badge, markeringen,
  uitleg). Toeschouwers krijgen geen voorspelling. De host kan hulp voor de
  hele kamer uitzetten, en iedereen kan hem voor zichzelf uitzetten. Toch
  blijft het een ongelijk speelveld waar de tegenstanders niet van weten. Een
  open vraag is of de kamer moet zien *dat* er hulp actief is, zonder te
  tonen voor wie.
- **Afhankelijkheid en de terugkoppellus.** Als hulp werkt, gaan de
  resultaten omhoog, daalt P(scum) en verdwijnt de hulp. Daarna zakt de
  speler weer terug. Daarom tellen *alle* rondes met hulp (gewonnen of niet)
  maar half mee, zowel voor het winstpercentage als voor het aantal keer
  Scum. Bij training worden rondes met hulp weggefilterd. Bij echte inzet zou
  je die lus moeten blijven meten.
- **Privacy.** De geschiedenis staat alleen in de `localStorage` van de
  eigen browser, per bijnaam. Het model draait lokaal in TypeScript. Er gaat
  geen data naar een server of een externe API, en "Forget my history" wist
  alles. Een MCP-coach zou dat veranderen: zodra context naar een LLM gaat,
  zijn toestemming en minimale gegevens nodig.
- **Transparantie.** De speler ziet zijn eigen P(scum), en het
  instellingenmenu noemt de drie kenmerken die de kans het meest omhoog
  duwen. Dat kan omdat het model lineair is: de log-odds zijn precies de som
  van de bijdragen per kenmerk (coëfficiënt × gestandaardiseerde waarde), en
  de kansen zijn gekalibreerd, zodat "62%" ook echt iets betekent. De console
  toont de volledige berekening en de drempels. De beslisboom voorspelde niet
  beter, en zou geen nette optelsom van redenen geven.
- **Een redelijk kenmerk kan verkeerd uitpakken.** Zie het uur hierboven: het
  geeft 's nachts iets *minder* hulp. Dat zie je alleen door de effecten te
  meten (gevoeligheidsanalyse), niet door naar de kenmerken te kijken.
- **Etikettering.** "Je kans om laatste te worden is 70%" kan ontmoedigend
  werken. De formulering moet steunend blijven, en hulp moet altijd uit te
  zetten zijn.

## Beperkingen

- De trainingsdata is gesimuleerd, met effecten die we zelf hebben ingebouwd.
  Validatie op echte spelers ontbreekt.
- Het model kent alleen tafels van vier. Voor andere groottes zijn de
  handsterkte en de getoonde kans gecorrigeerd, maar niet opnieuw getraind.
- De testset is klein (9 spelers) en de handen worden echt willekeurig
  gedeeld, dus de cijfers verschillen per run. De hier genoemde waarden komen
  uit één run.

# Roadmap: 67 Beschaving

Het idle-spel achter de 67 counter (`/counter/<key>`). Deze roadmap is vooral
voor Claude: lees hem aan het begin van elke sessie over dit spel, samen met
[FEEDBACK.md](FEEDBACK.md).

## Scope

- **Voorlopig telt alleen de browser op een computer.**
- Telefoons en aanraakschermen hoeven niet te werken, en je hoeft er ook niet
  op te testen.
- De bestaande CSS en aanraakbediening voor telefoons blijven gewoon staan,
  maar steek er geen werk in.
- Feedback over telefoons noteer je in FEEDBACK.md, maar je plant het niet in.

## Werkwijze voor Claude: feedback gaat in updates

Feedback wordt niet punt voor punt gebouwd, en ook niet allemaal tegelijk.
Claude bundelt het in **updates**: samenhangende pakketjes met één thema,
die elk een eigen branch en PR krijgen.

1. **Verzamelen** ("verwerk de feedback"): lees FEEDBACK.md → **Nieuw** en
   deel elk punt in bij een update hieronder.
   - Past het bij een geplande update, dan komt het daarin. Anders maak je
     een nieuwe update aan.
   - Een update heeft één thema, bijvoorbeeld "Wegen & bruggen" of "Balans
     tijdperk 1–3".
   - Een update moet in één review te overzien zijn: richtlijn 3–6 punten.
     Wordt hij groter, splits hem dan.
   - Feedback die over hetzelfde gaat, wordt één punt.
   - Wil je een punt niet doen, schrijf dan in FEEDBACK.md waarom.
2. **Bij het verzamelen bouw je nog niets.** Werk alleen deze roadmap en
   FEEDBACK.md bij. Geef de gebruiker daarna een korte samenvatting: welke
   updates klaarstaan en wat erin zit.
3. **Bouwen doe je één update tegelijk**, en alleen op verzoek ("doe update 3"
   of "doe de volgende update").
   - Eén branch `framework/idle-update-<n>-<kort>` en één PR.
   - In de PR-beschrijving staat per punt wat er veranderd is.
   - Zet de status op *bezig*, en op *in review* zodra de PR open staat.
   - Een PR gaat altijd naar `main`, ook als hij op een andere update
     steunt die nog niet gemerged is. Een PR met een andere update-branch als
     basis belandt na de merge niet op `main` (zo ging het met PR #28 en
     #29). Steunt hij op een open PR, zet dat dan in de beschrijving; de
     diff wordt vanzelf kleiner zodra die eerste PR gemerged is.
4. **Commit per onderdeel, niet per feedbackregel.** Maak een paar logische
   commits per update, bijvoorbeeld regels + tests, dan UI, dan docs.
5. **Na de merge** zet je de update op *gedaan*. Verplaats de feedback in
   FEEDBACK.md naar **Verwerkt**, met "Update n (PR #x)" erbij.
6. **Spoedgeval:** een bug die spelers blokkeert, mag een eigen kleine
   fix-PR krijgen, buiten de updates om.

Daarnaast blijft gelden:
- Twijfel je over een spelregel (balans, wat wel of niet via een stemming
  gaat)? Vraag het eerst.
- Voor je commit: `npm test`, `npm run build` en `npm run typecheck`.
- Raakt een update de UI, test dan ook in de browser (Playwright met Edge,
  venster van 1280×800), met een tijdelijke `COUNTER_FILE` zodat de echte
  `data/` niet wordt aangeraakt.

## Waar zit wat

| Wat | Bestand |
| --- | --- |
| Regels: productie (ook mijnen en smeden), geluk, kosten, stemmen, paden, muren, afbreken, doelen en wonderen, supply drops, aanvallen | `shared/idle.ts` |
| Getallen en content: grondstoffen, tijdperken (doelen, wonderen), gebouwen, winkels, gelukjes | `shared/idleContent.ts` |
| Kaart, natuur, waar gebouwen en paden mogen | `shared/idleMap.ts` |
| Server: opslag (`data/idle.json`), invoercontrole, stemmen afhandelen | `server/src/idle.ts`, `server/src/counter.ts` |
| Browser: wereld, panelen, NPC's, padvinden | `client/src/world/*`, `client/src/counter.ts` |
| Tests | `tests/idle.test.mts` |

Volledig resetten om te testen: stop de server, verwijder `data/counter.json`
en `data/idle.json`, en start opnieuw.

## Updates

<!-- Sjabloon voor een nieuwe update:
### Update <n>: <thema>
Status: gepland | bezig | in review (PR #x) | gedaan (PR #x)

- [ ] <wat er moet gebeuren> (bron: feedback <datum>, <wie>)
-->

Volgorde: van boven naar beneden, op volgorde van belangstelling. De
nummers volgen die volgorde, dus "doe de volgende update" is de bovenste die
nog gepland staat. Een latere update kan steunen op een eerdere; dat staat er
dan bij. Alle bronnen zijn feedback van 2026-10-22, tenzij anders vermeld.

### Update 3: Overzicht & bediening
Status: gedaan (PR #28, samen met update 4 naar main in PR #30)

- [x] Een balkje per grondstof in de HUD dat laat zien hoe vol de opslag is.
      (bron: "een balk voor resources")
- [x] Zoomen met het touchpad is veel te traag. Behandel touchpad-scrollen
      (`wheel` met kleine `deltaY`, of pinch met `ctrlKey`) apart van een
      muiswieltje. (bron: "scrollen op mousepad werkt veel te traag")
- [x] Klik op een dorpeling voor een duidelijk overzicht: werk of werkloos,
      waar die woont en wat die doet. (bron: "als je op iemand klikt een
      duidelijk overzicht van job status")
- [x] Bug: een dorpeling zegt dat die werkloos is terwijl die wel werkt. De
      browser bepaalt zelf wie welk werk heeft (`client/src/world/villagers.ts`),
      los van `assignWorkers`; laat dat overeenkomen. (bron: "iemand zegt dat
      die werkloos is, ma die is nie werkloos")

### Update 4: Dorpelingen doen het werk
Status: gedaan (PR #29, samen met update 3 naar main in PR #30)

- [x] Klikken op natuur levert geen grondstoffen meer op (`gather` en de
      move `{ type: "gather" }` in `shared/idle.ts`). Al het andere blijft
      klikbaar: een tegel kiezen om te bouwen, paden, stemmen, markt en
      winkels. (bron: speler, "maak de recourses nietmeer clickable maar dat
      de mannetjes het werk doen")
- [x] Dorpelingen zonder baan verzamelen zelf langzaam uit de natuur in de
      buurt, en gebruiken die op zoals klikken nu doet. Zo valt het begin, nog
      zonder werkgebouw, niet stil. (bron: idem, "meer idle")
- [x] Klik op een werkloze dorpeling en kies wat die gaat verzamelen (hout,
      steen, voedsel, …). Dat is gedeelde staat op de server, bijvoorbeeld
      het aantal werklozen per grondstof, en niet per browser: de NPC's zijn
      nu alleen iets van de browser. (bron: Richard, "wel de mannetjes kan
      klikken zodat je kan kiezen wat ze gaan doen als ze bv nog geen job
      hebben")
- [x] Duidelijker welke banen er zijn, en kunnen kiezen wie waar werkt.
      (bron: "duidelijkere jobs / jobs kiezen")

### Update 5: Dorpelingen op straat
Status: gedaan (PR #31)

- [x] Dorpelingen lopen bij voorkeur over wegen en paden, en nooit dwars door
      gebouwen. Gebouwen gelden als niet beloopbaar in `path.ts`, en wegen
      zijn goedkoper om over te lopen. (bron: "laat de npcs de roads gebruiken
      en nie gwn door de huizen glitchen")
- [x] Minder willekeurige NPC's. Toon een deel van de inwoners, of laat de
      spelers duidelijker opvallen. Gedaan: allebei, zo'n 40 inwoners op de
      kaart, spelers groter en met een gloed. In update 6 verder omlaag
      naar één per speler online. (bron:
      "teveel random npc's")
- [x] Een extra zin voor dorpelingen: "Who's gonna carry the logs and the
      boats?" (bron: "extra line")
- [x] Dorpelingen lopen niet meer naar natuur waar een pad over ligt. (bron:
      bekende beperking)

### Update 6: Eten & dieren
Status: gedaan (PR #32)

Afgesproken met Richard (2026-10-23): voedsel blijft één voorraad, met een
soort per bron; vier voedselgebouwen; een jagerskamp vangt minder waar het
bos gekapt is; veehouderij pas vanaf de Bronstijd.

- [x] Akkers als gebouw, voor voedsel van het land. Gedaan: de Akker
      (graan), met velden op de tegel. (bron: "Farm land")
- [x] Dieren in de wereld: jagen, en dieren houden (veeteelt). Gedaan: het
      Jagerskamp staat bij het bos en vangt zoveel als er nog bos rondom
      staat, zonder het te kappen. De Veehouderij heeft een wei met vee.
      Herten en zwijnen lopen in de bossen bij het dorp, minder waar gekapt
      is; ze zijn alleen om te zien. (bron: "Animals, Hunting, Animal
      husbandry")
- [x] Visserij aan de rivier. (bron: "fishery")
- [x] Verschillende soorten voedsel: graan, vlees, vis, en bessen van wie
      zonder baan verzamelt. Het is één 🍖 in de opslag, maar `foodKindsOf`
      geeft per soort wat het dorp maakt, voor update 7. (bron: "variatie in
      voedsel")
- [x] Minder dieren en minder dorpelingen op de kaart. Gedaan: één dier per
      8 bomen en hoogstens één per bos (was per 4, hoogstens 3). Van de
      inwoners loopt er nog één per speler online rond (`NPCS_PER_PLAYER`),
      naast de spelers zelf. (bron: Richard, 2026-10-23, "minder dieren, de
      bossen staan echt vol", "per speler 1 extra npc")

### Update 7: Geluk & wonen
Status: gedaan (PR #33). Steunt op update 6 (soorten voedsel, `foodKindsOf`).

Afgesproken met Richard (2026-10-24): inwoners komen af op een gelukkig
dorp, ook als er geen bed is, en ze vertrekken uit een ongelukkig dorp.
Geluk maakt werkers en verzamelaars ×0,5 tot ×1,2 zo hard. Decoraties en de
taverne (en een feest) geven geluk. Inwoners eten geen voedsel op; alleen de
variatie telt.

- [x] Een geluksniveau voor het dorp. Ongelukkige inwoners werken minder
      hard. Gedaan: `happinessOf` geeft 0–100%, met 50 als basis. Decoraties
      geven +4 per stuk (samen hoogstens +20), de taverne +10 en een
      dorpsfeest +15. (bron: "Happiness level")
- [x] Iedere inwoner heeft een plek in een huis nodig. Wie geen huis heeft,
      wordt ongelukkig, in plaats van dat een huis gewoon bevolking oplevert.
      Gedaan: een huis geeft bedden. `population` groeit of krimpt met 1 per
      minuut naar `populationTarget`: van de helft van de bedden (ongelukkig)
      tot een kwart meer dan er bedden zijn (gelukkig). Wie buiten slaapt,
      kost zoveel procent van 60 punten als het deel van het dorp dat buiten
      slaapt. (bron: "elke persoon heeft een huis nodig of die worden
      ongelukkig")
- [x] Te weinig variatie in voedsel maakt mensen boos. Gedaan: 1 soort is −20,
      2 soorten 0, 3 soorten +10 en 4 soorten +20. (bron: "variatie in
      voedsel of mensen worden boos")
- [x] Een bevolkingsoverzicht op een vaste plek, bijvoorbeeld in een raadhuis.
      Gedaan: het centrum heeft een blok 📊 Bevolking, en de HUD toont
      bedden, wie buiten slaapt en het geluk. (bron: "Population overzicht
      plek zoals een council house")

### Update 8: Tijdperken door het dorp
Status: gedaan (PR #34). Hierin zat ook de reset van het dorp.

Afgesproken met Richard (2026-10-24): het tijdperk hangt niet meer aan de
67 counter, want dat gaat te traag. Het dorp verdient het zelf, met doelen
per tijdperk (voorstel A) en een wereldwonder (voorstel C). De counter
geeft alleen nog extra's.

- [x] Doelen per tijdperk, bijvoorbeeld een aantal inwoners, een minimaal
      geluk, soorten voedsel en bepaalde gebouwen. Ze staan in het
      centrumpaneel. Gedaan: `ERA_GOALS` en `eraGoals`. Voor de Steentijd:
      15 inwoners, 50% geluk, 3 soorten voedsel en een Schuur. (bron:
      Richard, "tijdperk berekend door hoe goed de stad het doet")
- [x] Een wereldwonder per tijdperk (Stonehenge, piramide, colosseum, …),
      gebouwd via stemmingen in een paar fases. Kan pas als de doelen
      gehaald zijn. Is het af, dan begint het volgende tijdperk. Gedaan: 3
      fases (`WONDER_PHASES`), met 6 uur bouwtijd ertussen
      (`WONDER_BUILD_MS`). Het wonder blijft daarna staan als monument.
      (bron: idem)
- [x] Tempo: er is geen vaste tijd per tijdperk. Het hangt er gewoon van
      af hoe snel het dorp de doelen haalt en het wonder bouwt. Maak die wel
      flink, zodat een tijdperk eerder dagen dan uren duurt (richtlijn: "een
      week of 2"). Er wordt gespeeld tot eind december. Gedaan: de 6 uur
      bouwtijd tussen fases, plus de doelen. Bekijk het opnieuw in update
      12. (bron: Richard, 2026-10-24)
- [x] De counter geeft extra's, gekoppeld aan de hoogste stand zodat op en
      neer klikken niets oplevert. Elke +1 blijft ×2 productie voor 67 s.
      Elke nieuwe 67 geeft een supply drop: een krat met grondstoffen die
      iemand openklikt. Af en toe is er een willekeurige gebeurtenis bij een
      +1: een gouden uur, nieuwkomers, een feest (+geluk) of een rondtrekkende
      koopman. Gedaan: 1 op 67 kans per +1, hoogstens één per half uur. Een
      krat bevat 5 minuten productie. (bron: Richard, "de counter mag dienen
      als random extra's")
- [x] Reset van het dorp: alles begint opnieuw in de Steentijd. Spelers
      houden hun naam en uiterlijk. Gekochte kleding verdwijnt, en wie die
      droeg, krijgt de gratis variant. Dit gaat via een nieuwe
      `STATE_VERSION` zonder overzetten, zodat niemand bij de server-bestanden
      hoeft. (bron: Richard, "de game resetten na deze updates")

### Update 9: Mijnen & smeden
Status: in review (PR #35).

Afgesproken met Richard (2026-10-25): één soort Mijn, tegen de berg; de
spelers stemmen welk erts hij delft (alles wat ontgrendeld is). Kolen vanaf
de IJzertijd. De wapensmid en harnassmid maken wapens en harnassen uit metaal
en kolen, en verbruiken die.

- [x] Mijnen als echte bouwplek voor steen en erts, en meer mijnen dan alleen
      bij de ertsaders. Gedaan: de 🏔️ Mijn (Vuursteenmijn in de Steentijd)
      staat hoogstens `MINE_RANGE` (5) tegels van de berg. Hij raakt nooit op,
      maar maakt de helft (`oreShare`) van een groeve of een mijn bij de ader.
      Een stemming "⛏️ … delven" zet hem op een ander erts (`ore` op het
      gebouw), gratis. (bron: "Mines")
- [x] Kolen eerder of belangrijker maken: nu komen ze pas in de Industriële
      revolutie. Gedaan: kolen, de Kolenlaag en de Kolenmijn vanaf de
      IJzertijd. De Industriële revolutie houdt kolen als speciale
      grondstof voor de bouwkosten. (bron: "coal")
- [x] Een wapensmid en een harnassmid, nodig voor update 10. Gedaan: vanaf de
      IJzertijd. Ze maken 🗡️ wapens en 🛡️ harnassen en gebruiken per stuk
      1 ijzer en 1 kolen (`consumes`). Zonder die voorraad staan ze stil. De
      winkel Smederij heet in de IJzertijd nu Smidse. (bron: "weapon smith",
      "armor smith")

### Update 10: Vijanden & muren
Status: in review (PR #36). Steunt op update 9 (wapens en harnassen).

Afgesproken met Richard (2026-10-25): af en toe een aanval, een uur van
tevoren aangekondigd en te zien op de kaart. Verdediging: muren, torens en
wachters met wapens en harnassen. Verliest het dorp, dan stelen ze een deel
van de voorraad, gaan er een paar inwoners dood, raakt een gebouw beschadigd
(het werkt niet tot het via een stemming hersteld is) en is het dorp een
tijdje minder gelukkig.

- [x] Vijanden die het dorp af en toe aanvallen. Gedaan: vanaf de Bronstijd
      (`RAID_FROM_ERA`), 20 tot 36 uur na de vorige, alleen tussen 10 en 22
      uur Nederlandse tijd. Een uur van tevoren (ook na lange afwezigheid)
      verschijnt een bende met een zwarte vlag aan de rand van het dorp, en
      een chip in de HUD. Kracht: 15 + 15 per tijdperk + 0,4 per inwoner,
      ±20%. Verloren: tot 40% van elke grondstof weg, tot 10% van de inwoners
      dood (minstens 1), een werkgebouw, huis of schuur in brand en
      6 uur −15 geluk. Gewonnen: 3 uur +10 geluk. Elk gevecht kost 10% van
      de wapens en harnassen. (bron: "enemies")
- [x] Muren en verdediging, die je bouwt via de gewone stemmingen. Gedaan:
      muren teken je zoals paden (🧱 in de tekenbalk), op vrij land bij het
      dorp; de hele muur gaat samen omhoog per tijdperk (Palissade, Aarden
      wal, Stenen muur, …). Een 🗼 toren is een gebouw. Verdediging: 0,2 per
      inwoner, 1 per gewapende wachter (20 wapens × 4^tijdperk), 0,5 per
      harnas, 0,5 × (1 + niveau) per muurtegel, 10 × (1 + niveau) per toren.
      Het overzicht staat bij het centrum. (bron: "Walls")
- [x] Een gebouw in brand doet niets (geen werkers, bedden of opslag) tot een
      stemming 🔧 het herstelt, voor 30% van de bouwprijs.

### Update 11: Uiterlijk
Status: in review (PR #37).

Afgesproken met Richard (2026-10-25): installeer `create-game-assets`,
`game-feel`, `procedural-gen` en `tower-defense` (die laatste voor update 10)
in `~/.claude/skills`, niet in de repo.

- [x] Uitzoeken welke skills uit
      https://github.com/gamedev-skills/awesome-gamedev-agent-skills bruikbaar
      zijn. Installeren pas na een ok van Richard. Gedaan: de meeste skills
      gaan over engines (Godot, Unity, …); deze vier passen bij een spel dat
      alles zelf op een canvas tekent. Ze staan in `~/.claude/skills`, niet
      in de repo. (bron: "gebruik skills van gamedev")
- [x] Nieuwe textures, met die skills. Gedaan: de art direction staat boven
      in `client/src/world/draw.ts` (licht van linksboven, geen omlijning,
      een vormentaal per tijdperk). Het gras heeft een zachte ruis (value
      noise), plukjes gras en hier en daar een bloempje, wilder in de vroege
      tijdperken (`procedural-gen`). Een nieuw gebouw "popt" omhoog (squash
      & stretch, `game-feel`), en bij een aanval schudt het beeld. (bron:
      "Retexturing nadat de gamedev skills erdoor zijn gegaan")
- [x] De tijdperken moeten echt historisch aanvoelen. Gedaan voor het begin:
      in de Steentijd wonen de mensen in tipi's van huiden, en de rest
      bestaat uit ronde hutten van leem onder een strokegel. De uitkijkpost
      staat op palen. In de Bronstijd is alles een groot rond huis (Keltisch
      roundhouse). Vanaf de IJzertijd blijven het rechthoekige huizen.
      (bron: "Tijdperk voelt nu niet als prehistory")

### Update 12: Balans
Status: gepland. Bouw deze pas als er een paar dagen gespeeld is, en na
update 4 (zonder klikken verandert het tempo).

- [ ] Kijk hoe snel een groep door een tijdperk heen komt. Pas zo nodig
      `BUILD_COST_MULT`, `COST_GROWTH` en de productie aan in
      `idleContent.ts`. (bron: Richard, "het tempo ligt te hoog")
- [ ] Grondstoffen moeilijker maken om te krijgen. (bron: "moeilijker
      resources")
- [ ] De kosten van het Groot dorpsfeest laten meegroeien met de bevolking,
      niet alleen met het tijdperk. (bron: "dorpsfeest resources moeten scalen
      met population")

### Update 13: De raad
Status: gepland.

- [ ] In het centrum (het raadhuis) een blok 🗳️ De raad: de geplande updates
      uit deze roadmap, met per speler één stem die je kan verzetten. De
      stand is voor iedereen te zien. De lijst staat in
      `shared/idleContent.ts`; Claude houdt hem bij als de roadmap verandert.
      (bron: Richard, 2026-10-25, "soviet city council type beat")
- [ ] De uitslag wordt bewaard in de staat van het dorp. Claude kijkt er aan
      het begin van een sessie naar en zet de updates in die volgorde. Draait
      de server niet op deze computer, dan is er een knop 📋 die de uitslag
      kopieert, om in FEEDBACK.md te plakken. (bron: idem, "wordt bij de
      volgende claude sessies naar gekeken")
- [ ] Spelers kunnen in de raad zelf een idee insturen. Het komt in de raad
      te staan als "ingestuurd", en Claude neemt het mee als feedback.
- [ ] Werkwijze bijwerken: "verwerk de feedback" leest ook de uitslag van de
      raad.

### Update 14: Je eigen dorpeling
Status: gepland. Eerst met Richard afstemmen: hoe een relatie groeit (tijd
samen online, iets doen voor elkaar, samen werken) en of ook de gewone
inwoners meedoen of alleen spelers.

- [ ] Je eigen mannetje besturen: zeg welke baan of taak het heeft. Het loopt
      daarheen en werkt mee zolang je online bent. (bron: Richard,
      2026-10-25, "alleen je eigen mannetje kan besturen")
- [ ] Vrienden maken: klik op een andere speler om iets samen te doen (praten,
      helpen, iets geven). Elk paar spelers heeft een relatie die groeit, en
      langzaam zakt als je elkaar niet ziet. (bron: idem, "vrienden kan maken")
- [ ] Relaties tussen andere spelers verbeteren, zoals een koppelaar. (bron:
      idem)
- [ ] Een overzicht van je relaties, bij je NPC.

### Update 15: Liefde & trouwen
Status: gepland. Steunt op update 14. Beide spelers moeten zelf ja zeggen
voor ze iets samen beginnen.

- [ ] Een relatie die een piek bereikt, geeft een kans op romantiek. In beeld
      blijft het bij een hartje en een huisdeur die even dicht gaat; soms
      komt er een kind bij (+1 inwoner). (bron: Richard, 2026-10-25, "een
      kans geven op sex")
- [ ] Trouwen: allebei ja zeggen, dan een bruiloft in het dorp (+geluk voor
      een tijdje). (bron: idem, "of nog groter, trouwen")
- [ ] Vreemdgaan: wie getrouwd is en met iemand anders een sterke relatie
      opbouwt, breekt het huwelijk. Het dorp hoort ervan. (bron: idem, "een
      sterke relatie opbouwen met iemand anders zal deze trouw breken")

### Update 2: Paden, bruggen, afbreken, stemmen
Status: gedaan (PR #27)

- [x] Bouwen is duurder: ×1,5 en ×1,2 per exemplaar.
- [x] Paden teken je zelf, ook door de natuur heen en als brug over de rivier.
- [x] Afbreken van gebouwen en paden via een stemming, voor 25% van de kosten
      terug.
- [x] Stemmingen staan rechts in een lijst en blijven 24 uur open.
  - Een voorstel gaat door met meer dan een derde van wie online is, en nooit
    met minder dan 2 ja-stemmen.
  - Een aangenomen voorstel wacht op grondstoffen als het dorp het nog niet
    kan betalen.

### Update 1: De idle-game
Status: gedaan (PR #26)

- [x] Tijdperken per 67, gebouwen, winkels, markt, NPC's per speler en natuur
      die opraakt.

## Bekende beperkingen

Geen bugs die spelers blokkeren, maar wel goed om te weten. Een punt kan in
een update worden opgenomen als het past.

- **Natuur onder een pad:** de natuurplek houdt haar volle voorraad. Werkgebouwen
  en verzamelaars in de buurt kunnen er dus nog uit "putten". In het dorp lopen
  verzamelaars er wel omheen.
- **Dorpelingen onderweg:** wie al aan het lopen is als er een gebouw of pad
  bijkomt, loopt die ronde nog de oude route. Pas de volgende keer kiest die
  een nieuwe.
- **Straten upgraden:** dit kost een vast bedrag per tijdperk, hoe groot het
  wegennet ook is.
- **Stemmen voor de hello:** een stem van een verbinding die nog geen `hello`
  heeft gestuurd, telt per verbinding en niet per speler. De browser stuurt
  `hello` meteen bij het verbinden, dus in de praktijk speelt dit niet.
- **Voedselgebouwen delen hun prijsstijging:** het zoveelste voedselgebouw
  kost evenveel, welk soort het ook is (`costGroup`). Zo maakt het opsplitsen
  voedsel niet goedkoper. Voor de rest is alles even sterk als de oude
  boerderij; de balans komt in update 12.
- **Geluk en bevolking bij een lange afwezigheid:** `advance` rekent een
  hele periode met het geluk en het aantal inwoners van het begin ervan. De
  server rekent vaak door, dus dit speelt alleen na lang niemand online.
- **Wonderfase en opslag:** de laatste fase van Stonehenge kost precies
  800 hout en 800 steen. Dat is wat een Kampvuur met één Schuur kan opslaan.
  Wordt de kostenschaal veranderd, kijk dan of de opslag nog volstaat.
- **Berichtgrootte:** `MAX_PATH_TILES` (150) en de `maxPayload` van de
  counter-socket (2048 bytes) horen bij elkaar. Verhoog je het ene, controleer
  dan het andere. Daar is een test voor.
- **Smeden in de browser:** de smeden gebruiken ijzer en kolen uit de opslag.
  De browser rekent dat na met dezelfde `advance`. Tussen twee berichten van
  de server kan de HUD dus even een andere voorraad tonen dan de server.
- **Muren houden niemand tegen op de kaart:** dorpelingen lopen er gewoon
  door (alsof er overal poorten zitten), en de vijanden lopen er in beeld
  overheen. Voor het gevecht telt alleen hoeveel muur er staat, niet of het
  dorp helemaal dicht is.
- **Aanvallen alleen met iemand online:** de server rekent alleen door
  terwijl er iemand kijkt. Komt er lang niemand, dan wacht de aanval, en
  zodra iemand er is, komt er eerst een waarschuwing van een uur.

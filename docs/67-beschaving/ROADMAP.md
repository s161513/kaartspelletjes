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
| Regels: productie, kosten, stemmen, paden, afbreken | `shared/idle.ts` |
| Getallen en content: grondstoffen, tijdperken, gebouwen, winkels | `shared/idleContent.ts` |
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
Status: in review (PR #33). Steunt op update 6 (soorten voedsel, `foodKindsOf`).

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
Status: gepland. Steunt op update 7 (bevolking en geluk). Hierin zit ook
de reset van het dorp.

Afgesproken met Richard (2026-10-24): het tijdperk hangt niet meer aan de
67 counter, want dat gaat te traag. Het dorp verdient het zelf, met doelen
per tijdperk (voorstel A) en een wereldwonder (voorstel C). De counter
geeft alleen nog extra's.

- [ ] Doelen per tijdperk, bijvoorbeeld een aantal inwoners, een minimaal
      geluk, soorten voedsel en bepaalde gebouwen. Ze staan in het
      centrumpaneel. (bron: Richard, "tijdperk berekend door hoe goed de stad
      het doet")
- [ ] Een wereldwonder per tijdperk (Stonehenge, piramide, colosseum, …),
      gebouwd via stemmingen in een paar fases. Kan pas als de doelen
      gehaald zijn. Is het af, dan begint het volgende tijdperk. (bron: idem)
- [ ] Tempo: er is geen vaste tijd per tijdperk. Het hangt er gewoon van
      af hoe snel het dorp de doelen haalt en het wonder bouwt. Maak die wel
      flink, zodat een tijdperk eerder dagen dan uren duurt (richtlijn: "een
      week of 2"). Er wordt gespeeld tot eind december. (bron: Richard,
      2026-10-24)
- [ ] De counter geeft extra's, gekoppeld aan de hoogste stand zodat op en
      neer klikken niets oplevert. Elke +1 blijft ×2 productie voor 67 s.
      Elke nieuwe 67 geeft een supply drop: een krat met grondstoffen die
      iemand openklikt. Af en toe is er een willekeurige gebeurtenis bij een
      +1: een gouden uur, nieuwkomers, een feest (+geluk) of een rondtrekkende
      koopman. (bron: Richard, "de counter mag dienen als random extra's")
- [ ] Reset van het dorp: alles begint opnieuw in de Steentijd. Spelers
      houden hun naam en uiterlijk. Gekochte kleding verdwijnt, en wie die
      droeg, krijgt de gratis variant. Dit gaat via een nieuwe
      `STATE_VERSION` zonder overzetten, zodat niemand bij de server-bestanden
      hoeft. (bron: Richard, "de game resetten na deze updates")

### Update 9: Mijnen & smeden
Status: gepland.

- [ ] Mijnen als echte bouwplek voor steen en erts, en meer mijnen dan alleen
      bij de ertsaders. (bron: "Mines")
- [ ] Kolen eerder of belangrijker maken: nu komen ze pas in de Industriële
      revolutie. (bron: "coal")
- [ ] Een wapensmid en een harnassmid, nodig voor update 10. (bron: "weapon
      smith", "armor smith")

### Update 10: Vijanden & muren
Status: gepland. Steunt op update 9.

- [ ] Vijanden die het dorp af en toe aanvallen. (bron: "enemies")
- [ ] Muren en verdediging, die je bouwt via de gewone stemmingen. (bron:
      "Walls")

### Update 11: Uiterlijk
Status: gepland.

- [ ] Uitzoeken welke skills uit
      https://github.com/gamedev-skills/awesome-gamedev-agent-skills bruikbaar
      zijn. Installeren pas na een ok van Richard. (bron: "gebruik skills van
      gamedev")
- [ ] Nieuwe textures, met die skills. (bron: "Retexturing nadat de gamedev
      skills erdoor zijn gegaan")
- [ ] De tijdperken moeten echt historisch aanvoelen. (bron: "Tijdperk voelt
      nu niet als prehistory")

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

### Eerst beslissen (nog niet ingepland)

- **Stemmen over welke update er komt** ("soviet city council type beat"):
  hoe komt de uitslag bij Claude terecht? Bijvoorbeeld een raadhuis waar
  spelers op de geplande updates stemmen, met een uitslag die in dit bestand
  wordt overgenomen. Ontwerp eerst afstemmen met Richard.
- **Relaties en gezinnen** ("relationships, sex, marriage"): bijvoorbeeld
  huwelijken en kinderen die de bevolking laten groeien. Dit is een spel voor
  vrienden en klasgenoten, dus houd het netjes. Omvang en toon eerst afstemmen
  met Richard.

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
- **Berichtgrootte:** `MAX_PATH_TILES` (150) en de `maxPayload` van de
  counter-socket (2048 bytes) horen bij elkaar. Verhoog je het ene, controleer
  dan het andere. Daar is een test voor.

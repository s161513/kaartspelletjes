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
| Regels: productie (ook mijnen en smeden), dag en nacht, opslag per grondstof, geluk (de meter), inwoners, kosten, stemmen, paden, muren en poorten, afbreken, doelen en wonderen, supply drops, aanvallen | `shared/idle.ts` |
| Getallen en content: grondstoffen, tijdperken (doelen, wonderen), gebouwen, winkels, gelukjes; de balans (`PRICE_MULT`, `BASE_RATE`, …) onderaan | `shared/idleContent.ts` |
| Kaart, natuur, waar gebouwen en paden mogen | `shared/idleMap.ts` |
| Server: opslag (`data/idle.json`), invoercontrole, stemmen afhandelen | `server/src/idle.ts`, `server/src/counter.ts` |
| Browser: wereld, panelen, NPC's, padvinden, de nacht en het licht (`night.ts`) | `client/src/world/*`, `client/src/counter.ts` |
| Pixel-art: sprites, atlas, eigen sprites (`pixelart.py`: Steen- en Bronstijd, `pixelnature.py`: water, oevers, bloemen, `pixeldecor.py`: decoraties), licenties | `client/src/world/sprites/` (na een wijziging: `python client/src/world/sprites/build.py`), `sprites.ts`, `pixel.ts` |
| Tests | `tests/idle.test.mts` |

Volledig resetten om te testen: stop de server, verwijder `data/counter.json`
en `data/idle.json`, en start opnieuw.

## Updates

<!-- Sjabloon voor een nieuwe update:
### Update <n>: <thema>
Status: gepland | bezig | in review (PR #x) | gedaan (PR #x)

- [ ] <wat er moet gebeuren> (bron: feedback <datum>, <wie>)
-->

Volgorde: van boven naar beneden, op volgorde van belangstelling. "Doe de
volgende update" is de bovenste die nog gepland staat. De nummers volgen
die volgorde niet helemaal: updates 17–22 (feedback van 2026-10-26) staan
vóór 13–15. Een latere update kan steunen op een eerdere; dat staat er
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
Status: gedaan (PR #35).

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
Status: gedaan (PR #36). Steunt op update 9 (wapens en harnassen).

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
Status: gedaan (PR #37).

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
Status: gedaan (PR #39). Hierin zat ook een reset van het dorp.

Afgesproken met Richard (2026-10-26): productie ÷2 en alles ×2 zo duur
(optie "3–4 dagen"), maar de wonderfases blijven 24 uur uit elkaar. De
verhoudingen blijven gelijk; later maak je veel meer, maar alles is dan ook
evenredig duurder (×4 per tijdperk, zoals het was). Geen ruilen meer. Geluk
1 punt per 10 minuten, 1 inwoner per half uur. Het dorp begint opnieuw met
een Kampvuur, een Hut en een Schuur.

- [x] Het tempo: grondstoffen gaan te snel, zeker in de Steentijd; gebouwen
      moeten in het begin duurder zijn, en evenredig duurder blijven. Gedaan:
      `BASE_RATE`, `SPECIAL_BASE_RATE`, `GATHER_RATE` en de robots ÷2. Elke
      prijs (gebouwen, upgrades, herstel, wonderen, winkel, straten, paden,
      muren, kleding) ×`PRICE_MULT` (2), en de opslag ×2 zodat de duurste
      wonderfase er nog in past. Elk volgend exemplaar +30% (was +20%).
      Wonderfases 24 uur uit elkaar (was 6). Kratten minstens 60 van elk.
      (bron: Richard, "het tempo ligt te hoog"; "moeilijker resources";
      2026-10-26, "de resources zijn te snel, allesinds zeker voor het eerste
      tijdperk")
- [x] Ruilen in balans: je kon materiaal eindeloos omzetten. Gedaan: er is
      geen ruilen meer. De Ruilplaats, het Handelsakkoord van de bank en de
      rondtrekkende koopman zijn weg. Het doel van de IJzertijd is nu een
      Wapensmid in plaats van een Ruilplaats. (bron: 2026-10-26, "ruilen
      moet in balans")
- [x] Geluk gaat te snel omhoog. Gedaan: geluk is een meter (`happiness`)
      die 1 punt per 10 minuten (`HAPPY_STEP_MS`) naar zijn doel kruipt,
      omhoog en omlaag. De HUD toont ↗ of ↘ en waar hij heen gaat. Het
      werktempo en de doelen volgen de meter. Gevolg: een feest van 10
      minuten telt nog maar voor 1 punt. (bron: 2026-10-26, "happiness meter
      gaat ook te snel omhoog")
- [x] Er komen te snel mensen bij. Gedaan: 1 inwoner per 30 minuten
      (`MOVE_MS`, was 1 per minuut), en het aantal volgt de meter, niet het
      doel. Er vertrekt pas iemand als er een hele inwoner te veel is.
      Toelaten via een stemming komt in update 18. (bron: 2026-10-26, "er
      komen super snel mensen bij")
- [x] Het Groot dorpsfeest kost meer met meer inwoners: de prijs geldt voor
      10 inwoners (`PARTY_PEOPLE`), en groeit daarboven mee. (bron:
      "dorpsfeest resources moeten scalen met population")
- [x] Beginnen met een hut en een Schuur. Gedaan: een nieuw dorp heeft een
      Kampvuur, een Hut en een Schuur, 3 inwoners zonder werk, en 150 🍖,
      200 🪵 en 100 🪨. Via `STATE_VERSION` 7 begint het dorp opnieuw;
      spelers houden naam en uiterlijk. (bron: 2026-10-26, "begin met een
      hut en 1 Schuur als basisvoorziening")

### Update 17: Opslag & overzicht
Status: gedaan (PR #40). Steunt op update 12.

Afgesproken met Richard (2026-10-26): één opslaggebouw per grondstof.

- [x] Opslag per grondstof, niet één grens voor alles. Gedaan: elke
      grondstof heeft een eigen opslag (`stores` op het gebouwtype,
      `capOf(s, res)`): de Schuur houdt hout (hij houdt zijn oude id
      `storage`), de Voorraadkuil voedsel, de Steenstapel steen, en vanaf hun
      tijdperk een eigen opslag voor brons, ijzer, kolen, wapens, harnassen,
      goud, wol, kennis, olie, data, titanium en antimaterie. Elke grondstof
      heeft een basis van 400 plus 400 van het centrum (×4 per tijdperk); elk
      opslaggebouw geeft +800 voor zijn grondstof. De kratjes naast een
      opslag hebben de kleur van wat erin ligt. (bron: 2026-10-26, "niks van
      resources samenvoegen, opslag beter beheren (per resource)")
- [x] Werkers stoppen met werken als de opslag van hun grondstof vol is.
      Gedaan: ze gaan bij het kampvuur zitten ("opslag vol, pauze"), tot er
      weer plek is. Verzamelaars die zelf kiezen, gaan iets anders verzamelen
      dat nog niet vol is (`fullOf`, `gatheringOf`); wie door de spelers op
      een grondstof gezet is, pauzeert ook. Het menu (soorten voedsel)
      verandert niet door een volle voorraadkuil. (bron: 2026-10-26, "stoppen
      met werken als storage vol is")
- [x] De tooltips van de HUD glitchten omdat ze steeds ververst werden.
      Gedaan: de tooltips zijn kort en veranderen alleen als er echt iets
      verandert. Klik op een grondstof en je gaat naar zijn opslag, met een
      balk, hoe snel hij vol is en waar de grens uit bestaat. Klik op de
      inwoners, het geluk of een aanval en je gaat naar het centrum, dat nu
      ook een blok 📦 Opslag heeft met alle grondstoffen. Een volle grondstof
      zegt "vol" in de HUD; het geluk toont ook waar het heen gaat. (bron:
      2026-10-26, "hover functie bij de HUD glitcht")
- [x] De informatie over het tijdperk in een mooier overzicht. Gedaan: van
      tijdperk → naar tijdperk met "2/4 doelen", elk doel een blok met een
      icoon en een voortgangsbalk, en het wonder met een balk per fase.
      (bron: 2026-10-26, "deel de tijdperk informatie op in een mooier
      overzicht")
- [x] Klikken op een tegel achter een gebouw of boom. Gedaan: de tegel onder
      de muis telt eerst. Staat daar een gebouw of natuur, dan krijg je dat;
      is het vrij land, dan opent het bouwmenu van díe tegel, ook als er een
      dak of boom voor hangt. Een gestippelde rand bovenop toont welke tegel
      je kiest. Een gebouw kies je dus op zijn eigen tegel (de voet). (bron:
      2026-10-26, "geen melding dat je er niet op kan klikken")

### Update 18: Nieuwe inwoners
Status: gedaan (PR #41). Steunt op update 12 en 17.

Afgesproken met Richard (2026-10-26): een nieuwkomer gaat via een gewone
stemming (24 uur, minstens 2 keer ja); het profiel is alleen voor de sfeer;
een koppel kiest zelf wanneer het een kind krijgt.

- [x] Nieuwkomers komen alleen als er een vrij bed is. Gedaan: niemand trekt
      nog vanzelf in (`advance` laat alleen nog mensen vertrekken). Een
      nieuwkomer klopt aan (`stepNewcomer`) als er een bed vrij is en het
      dorp genoeg mensen trekt (`populationTarget`): één tegelijk, hoogstens
      één per 30 minuten. Ook het geluksevent "Nieuwkomers" vult alleen nog
      vrije bedden; zonder vrij bed wordt het een feest. (bron: 2026-10-26,
      "inwoners proberen alleen binnen te komen als er nog vrije
      slaapplaatsen zijn")
- [x] Een nieuwkomer met een profiel, en de spelers stemmen. Gedaan: naam,
      beroep (passend bij het tijdperk) en afkomst, alleen voor de sfeer. Het
      is een gewone stemming ("🚪 Pien mag blijven") die 24 uur openstaat;
      spelers kunnen dit zelf niet voorstellen. De nieuwkomer staat aan de
      rand van het dorp ("mag ik hier wonen? 🧳") en is aan te klikken. Bij het
      centrum staat wie er wacht. (bron: 2026-10-26, "moeten geaccepteerd
      worden door de samenleving (geef de NPC een profiel)")
- [x] Inwoners kunnen kinderen krijgen. Gedaan: elk koppel (2 inwoners)
      krijgt er zo'n keer per 48 uur (`BIRTH_MS`) een, op een willekeurig
      moment: het koppel kiest zelf (`stepBirth`). Dat gebeurt alleen met een
      vrij bed en minstens 50% geluk. Er komt meteen een volwassen inwoner
      bij, met een bericht "👶 … kregen een kind". (bron: 2026-10-26,
      "huidige inwoners kunnen kinderen maken")

### Update 19: Water, bloemen & decoraties
Status: in review (PR #42). Pixel-art, zoals in update 16.

- [x] Nieuwe golven op het water: die zien er slecht uit. Gedaan: het water
      is een eigen pixel-tegel in de kleuren van Yar (`sprites/pixelnature.py`).
      Korte golfjes komen op, glanzen en zakken weer, elk op een eigen moment,
      in 4 beelden die voor de hele rivier tegelijk wisselen. Vroeger wisselde
      elke tegel apart tussen drie tegels van Yar, waarvan er één een stukje
      oever in een hoek had: dat waren de rare vlekjes. (bron: 2026-10-26, "de
      golven zien er slecht uit", "retexture de bloemen en de golven")
- [x] Nieuwe bloemen in het gras en een nieuw bloemperk. Gedaan: zes soorten
      wilde bloemen (madeliefjes, boterbloemen, klaprozen, viooltjes, klaver,
      vergeet-mij-nietjes) als plukjes op het gras, meer in de vroege
      tijdperken. Het Bloemperk is een verhoogd bed met een stenen rand en rijen
      tulpen. (bron: idem)
- [x] Mooiere decoraties, als pixel-sprites. Gedaan: alle dertien
      (`sprites/pixeldecor.py`): het 67-standbeeld (de handen gaan om de beurt
      op en neer), een beschilderde totempaal met vleugels, een menhir met
      korstmos en een spiraal, het krijgers-, ridder-, David- en
      astronautenbeeld op een sokkel, een marmeren fontein met spuitend water,
      een bakstenen klokkentoren (het is altijd 6:07), een neonbord dat soms
      even uitvalt, een hologram dat boven zijn projector zweeft en het
      Mega-67-monument dat gloeit. (bron: 2026-10-26, "decoraties verbeteren")
- [x] Oevers langs het water. Gedaan: zelf getekend, want de oevers van Yar
      passen niet op elkaar. Elke kant van het water die aan land grenst krijgt
      een rand van zand en natte modder met schuim, dat meebeweegt met de
      golven; ook de hoekjes (`drawWaterTile` in `draw.ts`).

### Update 20: Dag & nacht
Status: in review (PR #43). Steunt op update 19 (PR #42).

Afgesproken met Richard (2026-10-27): een dag duurt 20 minuten en een nacht
ook. 's Nachts gaat het werk half zo snel. Vijanden komen een paar keer per
dag, altijd 's nachts en tussen 10:00 en 22:00. Een poort bouw je apart, via
een stemming.

- [x] Dag en nacht, elk 20 minuten. Gedaan: het gaat op de klok, dus voor
      iedereen tegelijk (`isNight`, `DAY_MS`, `NIGHT_MS`). 's Nachts ligt er
      donkerblauw over alles, met een schemering van ruim een minuut. Licht
      geven: het kampvuur en andere vuren, ramen van huizen, winkels en het
      centrum, fakkels op de torens, de smidse, brandende gebouwen, de
      fakkels van de vijanden, straatlantaarns vanaf de Industriële revolutie,
      en een lantaarn bij elke speler. Opslag en de meeste werkgebouwen
      blijven donker (`client/src/world/night.ts`). In de HUD staat of het dag
      of nacht is, en hoe lang nog. (bron: 2026-10-26, "dag/nacht cycle van
      20 minuten")
- [x] 's Nachts slapen de mensen in hun eigen huis. Gedaan: wie een bed heeft,
      gaat naar huis; wie buiten slaapt, gaat bij het vuur liggen (met een
      "z"). Ongeveer de helft draait nachtdienst en werkt door; daarom gaat het
      werk 's nachts ×0,5 (`NIGHT_WORK`, in `advance` en `ratesOf`). (bron:
      2026-10-26, "mensen moeten slapen in hun eigen huis")
- [x] De vijanden komen een paar keer per dag, 's nachts. Gedaan: om de 4 tot
      8 uur (was 20 tot 36), altijd in een nacht en tussen 10:00 en 22:00, met
      nog steeds een uur waarschuwing. Ze zijn even sterk als eerst, dus ze
      kosten het dorp meer dan vroeger. (bron: 2026-10-26, "de vijanden komen
      om de paar nachten")
- [x] Poorten in de muur. Gedaan: klik op een stuk muur, "🚪 Poort maken" gaat
      via een stemming en kost per poort 30 hout en 10 steen (×4 per niveau
      van de muur, ×2 balans). Dorpelingen lopen alleen nog door poorten; is
      er geen weg, dan klimmen ze er toch over. De vijanden lopen door een
      poort of klimmen over de muur (6× zo traag), en wachten voor de muur tot
      de aanval begint. Wie een muur weghaalt, haalt ook de poort weg. (bron:
      2026-10-26, "poorten om in de muur te kunnen zetten"; bekende beperking
      "muren houden niemand tegen")

### Update 21: Grote gebouwen
Status: gepland. Gebouwen beslaan nu één tegel; dit raakt de kaart, het
plaatsen en het padvinden.

- [ ] Elk wereldwonder is groter, met een eigen vorm: Stonehenge 3×3, de
      kathedraal in een kruisvorm, enzovoort. (bron: 2026-10-26, "de
      tijdperk monumenten moeten groter zijn (meerdere tegels)")
- [ ] Het centrum heet De Senaat en beslaat meerdere tegels; daar worden de
      stemmen en de feedback verwerkt (zie update 13). Bij het Kampvuur is
      het één tegel, met boomstammen eromheen waar mensen op zitten. (bron:
      2026-10-26, "de council heeft een gebouw De Senaat")

### Update 22: Gereedschap
Status: gepland. Eerst met Richard afstemmen: welke werkplaats wat maakt,
hoe zeldzaamheid werkt, en of er een minigame bij komt.

- [ ] Elke baan heeft eigen gereedschap: een houweel voor mijnwerkers, een
      bijl voor houthakkers, pijl en boog of een speer voor jagers, een
      hengel voor vissers. Zonder gereedschap werken ze trager. (bron:
      2026-10-26, "de werkplaatsen hebben individuele tools nodig")
- [ ] Werkplaatsen maken het gereedschap; het slijt. (bron: idem)
- [ ] Gereedschap kan zeldzaam zijn, met een bonus, misschien via een
      crafting-minigame. (bron: idem)

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
      daarheen en werkt mee zolang je online bent. De server houdt bij waar
      de mannetjes zijn, zodat iedereen hetzelfde ziet. (bron: Richard,
      2026-10-25, "alleen je eigen mannetje kan besturen"; 2026-10-26, "je
      kan mannetjes aansturen (ze worden ook server-sided)")
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

### Update 16: Pixel-art
Status: gedaan (PR #38).

Afgesproken met Richard (2026-10-26): het spel wordt pixel-art. Zoveel
mogelijk kant-en-klare sprites van internet; wat er niet is, maakt Claude zelf
in dezelfde stijl. Eerst een stijlproef, die is goedgekeurd.

- [x] Eén atlas met sprites, die bij het opstarten één keer geladen wordt
      (`client/src/world/sprites/`, gebouwd door `build.py`). Bronnen en
      licenties staan in `CREDITS.md`, en in het spel staat een regel credits
      (CC-BY vraagt dat). (bron: Richard, "betere textures die bij het
      opstarten ingeladen worden")
- [x] Natuur en grond uit Yar's "Isometric 64x64 Outside Tileset": gras,
      water, rotsen, bergen, struiken, bomen, boomstammen en puin. Straten en
      zand krijgen een korrel.
- [x] Gebouwen per tijdperk: de middeleeuwse stad van City Sim voor de
      IJzertijd tot en met de Renaissance, Pixel City (bakstenen huizen,
      flats, torens, kantoren, industrie) voor de Industriële revolutie tot en
      met de Digitale tijd. (bron: idem, "zodat het op een volwaardige game
      lijkt")
- [x] Eigen pixel-sprites voor de Steentijd en de Bronstijd: tipi's in drie
      kleuren, ronde hutten van vlechtwerk onder stro, Keltische roundhouses,
      uitkijkposten op palen en het kampvuur met vlammen
      (`sprites/pixelart.py`). (bron: Richard, "de kleine pixel-sprites in
      dezelfde stijl zijn goed en moet je ook doen voor de eerste tijdperk")
- [x] Al het andere (werkgebouwen, wonderen, decoraties, muren, mijnen,
      dorpelingen, dieren, overvallers, kratten, bruggen) wordt nog als vormen
      getekend, maar daarna omgezet naar pixel-art: harde randen, korrel, een
      donkere rand. Bewegende dingen krijgen een paar frames. (bron: Richard,
      "deze scherpe tipi's en tekeningen zijn qua stijl helemaal niet
      hetzelfde")
- [ ] Later, als er goede pakketten voor zijn: de Ruimte- en de
      Sci-fi-tijd, en de stenen muren van City Sim (welk stuk hoort bij welke
      richting?). De oevers zijn gedaan in update 19.

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
  boerderij.
- **Geluk en bevolking bij een lange afwezigheid:** `advance` rekent een
  hele periode met de geluksmeter en het aantal inwoners van het begin ervan. De
  server rekent vaak door, dus dit speelt alleen na lang niemand online.
- **Wonderfase en opslag:** de laatste fase van Stonehenge kost precies
  1600 hout en 1600 steen (en 1200 voedsel). Dat is wat een Kampvuur met één
  opslag voor die grondstof kan bewaren: een Schuur voor hout, een
  Steenstapel voor steen. Wordt de kostenschaal veranderd, kijk dan of de
  opslag nog volstaat.
- **Volle opslag in de browser:** of een werker pauzeert, ziet de browser
  aan de voorraad uit het laatste bericht van de server. Rond het moment dat
  iets vol raakt, kan een dorpeling dus nog even doorwerken of te vroeg gaan
  zitten. Op de kaart lopen er maar een paar rond, dus dat valt weinig op.
- **Berichtgrootte:** `MAX_PATH_TILES` (150) en de `maxPayload` van de
  counter-socket (2048 bytes) horen bij elkaar. Verhoog je het ene, controleer
  dan het andere. Daar is een test voor.
- **Smeden in de browser:** de smeden gebruiken ijzer en kolen uit de opslag.
  De browser rekent dat na met dezelfde `advance`. Tussen twee berichten van
  de server kan de HUD dus even een andere voorraad tonen dan de server.
- **Muren en het gevecht:** sinds update 20 lopen dorpelingen alleen door
  poorten en klimmen vijanden in beeld over de muur. Voor het gevecht telt nog
  steeds alleen hoeveel muur er staat, niet of het dorp helemaal dicht is.
- **Aanvallen alleen met iemand online:** de server rekent alleen door
  terwijl er iemand kijkt. Komt er lang niemand, dan wacht de aanval, en
  zodra iemand er is, komt er eerst een waarschuwing van een uur.
- **Alleen spelen en nieuwkomers:** een nieuwkomer heeft, zoals elke
  stemming, minstens 2 keer ja nodig. Wie alleen speelt, krijgt er dus niemand
  bij via de poort, alleen via kinderen.
- **Een nieuw dorp met één soort voedsel:** een nieuw dorp eet alleen
  bessen (−20 geluk). De meter zakt dan langzaam (1 punt per 10 minuten) en
  na een uur of twee vertrekt er iemand, tot er een jagerskamp, akker of
  visserij staat. Dat is de bedoeling: bouw eerst voedsel.

# Roadmap: 67 Beschaving

Het idle-spel achter de 67 counter (`/counter/<key>`). Deze roadmap is vooral
voor Claude: lees hem aan het begin van elke sessie over dit spel, samen met
[FEEDBACK.md](FEEDBACK.md).

## Werkwijze voor Claude

1. Lees **FEEDBACK.md → Nieuw**. Zet elk punt hieronder om in een concreet
   roadmap-item (of meerdere), of leg in FEEDBACK.md uit waarom niet.
2. Verplaats verwerkte feedback naar **FEEDBACK.md → Verwerkt**, met een
   verwijzing naar het roadmap-item of de PR.
3. Twijfel je over een spelregel (balans, wat wel/niet via stemming gaat)?
   Vraag het eerst; doe niet zomaar een aanname.
4. Werk op een `framework/…`-branch. Voor je commit: `npm test`,
   `npm run build` en `npm run typecheck`. Bij een wijziging aan de UI ook
   een check in de browser (Playwright met Edge, met een tijdelijke
   `COUNTER_FILE`, zodat de echte `data/` niet wordt aangeraakt).
5. Commit, push en open of werk een PR bij. Zet afgeronde items in
   **Gedaan**, met het PR-nummer.

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

## Gedaan

- **PR #26:** de idle-game zelf: tijdperken per 67, gebouwen, winkels,
  markt, NPC's per speler en natuur die opraakt.
- **PR #27:**
  - Bouwen is duurder: ×1,5, en ×1,2 per exemplaar.
  - Paden teken je zelf. Ze kunnen door de natuur heen en als brug over de
    rivier.
  - Afbreken via een stemming, voor 25% van de kosten terug.
  - Stemmingen staan rechts in een lijst en blijven 24 uur open.
  - Een voorstel gaat door met meer dan een derde van wie online is, en
    nooit met minder dan 2 ja-stemmen.
  - Een aangenomen voorstel dat nog niet betaald kan worden, wacht op
    grondstoffen.

## Volgende stappen

- [ ] **Testen op een telefoon:** paden tekenen met één vinger, rondkijken
      met twee vingers, en de ingeklapte stemlijst.
- [ ] **Balans na een paar dagen spelen bekijken:** hoe snel komt een groep
      door een tijdperk heen? Pas zo nodig `BUILD_COST_MULT`, `COST_GROWTH`
      en de productie aan in `idleContent.ts`.

## Bekende beperkingen

Geen bugs die spelers blokkeren, maar wel goed om te weten:

- **Natuur onder een pad:** de natuurplek houdt haar volle voorraad. Werkgebouwen in de buurt kunnen
  er dus nog uit "putten". Klikken op die tegel doet wel niets meer.
- **Dorpelingen en paden:** ze lopen soms naar een bos- of rotstegel waar inmiddels een pad over ligt.
  Dat is alleen een visueel foutje.
- **Straten upgraden:** dit kost een vast bedrag per tijdperk, hoe groot het
  wegennet ook is.
- **Stemmen voor de hello:** een stem van een verbinding die nog geen `hello` heeft gestuurd, telt per
  verbinding en niet per speler. De browser stuurt `hello` meteen bij het
  verbinden, dus in de praktijk speelt dit niet.
- **Berichtgrootte:** `MAX_PATH_TILES` (150) en de `maxPayload` van de
  counter-socket (2048 bytes) horen bij elkaar. Verhoog je het ene, controleer
  dan het andere. Daar is een test voor.

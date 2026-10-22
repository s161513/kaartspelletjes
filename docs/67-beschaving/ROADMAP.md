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

### Update 3: Balans
Status: gepland

- [ ] Balans bekijken na een paar dagen spelen: hoe snel komt een groep door
      een tijdperk heen? Pas zo nodig `BUILD_COST_MULT`, `COST_GROWTH` en de
      productie aan in `idleContent.ts`. (bron: 2026-10-22, Richard, "het tempo
      ligt te hoog")

### Update 2: Paden, bruggen, afbreken, stemmen
Status: in review (PR #27)

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
  in de buurt kunnen er dus nog uit "putten". Klikken op die tegel doet wel
  niets meer.
- **Dorpelingen en paden:** ze lopen soms naar een bos- of rotstegel waar
  inmiddels een pad over ligt. Dat is alleen een visueel foutje.
- **Straten upgraden:** dit kost een vast bedrag per tijdperk, hoe groot het
  wegennet ook is.
- **Stemmen voor de hello:** een stem van een verbinding die nog geen `hello`
  heeft gestuurd, telt per verbinding en niet per speler. De browser stuurt
  `hello` meteen bij het verbinden, dus in de praktijk speelt dit niet.
- **Berichtgrootte:** `MAX_PATH_TILES` (150) en de `maxPayload` van de
  counter-socket (2048 bytes) horen bij elkaar. Verhoog je het ene, controleer
  dan het andere. Daar is een test voor.

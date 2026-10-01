# Dobble in Classroom Games

Deze integratie gebruikt de actuele architectuur uit `origin/main` (`990cb7d`): automatische ontdekking van `games/<id>/meta.ts`, serverregels in `logic.ts`, browserweergave in `view.ts` en de bestaande `/game.html?game=dobble`-pagina.

## Spelen

Start vanuit de repository-root:

```sh
npm install
npm run dev
```

Maak via de normale startpagina een room, laat vrienden via de bestaande roomcode aansluiten en kies **Start Dobble** in de lobby. Dobble ondersteunt **2–8 verbonden deelnemers**. Een room met negen of meer verbonden spelers kan Dobble niet starten, conform de bestaande cataloguscontrole. De overige lobby-, room-, chat- en hostregels blijven van het platform.

De eerste speler met **10 punten** wint. Tik op het gedeelde symbool op jouw persoonlijke kaart. Een foutieve klik blokkeert jou 400 ms. Iedere ronde heeft één winnaar; na 1 seconde wordt automatisch een nieuwe centrale kaart gedeeld. Met minder dan twee verbonden deelnemers pauzeert het spel. Opnieuw verbinden via het bestaande systeem herstelt jouw kaart, score en actuele ronde.

Na afloop gebruik je **Back to lobby**. De host kan daar met dezelfde room opnieuw Dobble starten of een ander spel kiezen. Het platform heeft geen algemene spelinstellingen-interface: de integratie behoudt daarom het oorspronkelijke standaarddoel van 10 punten; de standalone keuzelijst voor 5/10/15/20 is niet overgezet. `TARGET_SCORE` staat in `logic.ts`.

## Wat is hergebruikt?

- De exacte projective-plane-constructie met orde 7 en de cryptografische shuffle uit het standalone deck: **57 kaarten, acht symbolen per kaart**.
- De 57 emoji en hun namen; rendering staat los van de numerieke symbol-ID's in de serverregels.
- De matchcontrole, punten, rondeafsluiting, 400 ms cooldown en 1 seconde feedbacktijd.
- De deterministische kaartposities, variabele groottes en rotaties uit de React-kaartcomponent, aangepast naar gewone DOM-elementen omdat het platform geen React gebruikt.
- Ronde kaarten, persoonlijk scoreaccent, groene matchglow, foutfeedback, rondewisselanimatie, winnaar en confetti. CSS blijft beperkt tot Dobble.

Het zelfstandige bronproject is niet aangepast. Er is geen tweede lobby, Socket.IO-server, sessiesysteem of roommanager toegevoegd. Het gewone speelkaartmodel met `rank` en `suit` is niet gebruikt voor Dobble.

## Noodzakelijke gedeelde wijzigingen

De nieuwste hoofdbranch stuurt standaard alle serverstate naar iedereen en werkt alleen met door spelers gestuurde updates. Dat volstaat niet voor persoonlijke Dobble-kaarten en automatische nieuwe rondes.

- `shared/game.ts`: optionele `playerView`, `nextUpdateIn`/`advance` en `playersChanged`-hooks. Bestaande games zonder hooks houden hun bestaande gedrag. De view krijgt optioneel spelers en verbindingsstatus, plus callbacks voor roomupdates en fouten.
- `server/src/rooms.ts`: past de projectie toe op starten, updates, eindstand en reconnect; beheert één timer per actieve game en geeft bestaande verbindings-/vertrekgebeurtenissen door aan de game.
- `server/src/handlers.ts`: gebruikt die bestaande manager voor persoonlijke berichten en timers. Validatie en statewisseling blijven synchroon, zodat één ronde maar één winnaar heeft.
- Bij reconnect negeert de close-handler een oude socket als de speler inmiddels een nieuwe socket heeft. De oude verbinding mag ook geen zetten meer uitvoeren. Deze kleine controles voorkomen dat een herstelde Dobble-speler weer ten onrechte offline wordt gezet.
- `client/src/gameHost.ts` en `ws.ts`: geven de bestaande roomgegevens/verbindingsstatus door, sturen geen tijdgevoelige gamezetten terwijl de socket dicht is, en geven fouten door aan de renderer. Een nieuw gestart ander spel gebruikt dezelfde bestaande game-URL.

Er zijn geen nieuwe protocolberichten, routerstructuur, authlaag of runtime-afhankelijkheden. Alleen `@playwright/test` is toegevoegd als ontwikkelafhankelijkheid voor reproduceerbare browsercontroles.

## Controles uitvoeren

Vanaf de repository-root:

```sh
npm run build
npm exec --workspace client -- tsc --noEmit
node --import tsx --test games/dobble/tests/logic.test.ts games/dobble/tests/multiplayer.test.ts
node node_modules/@playwright/test/cli.js test --config games/dobble/tests/playwright.config.ts
```

De eerste twee controles gebruiken de bestaande TypeScript- en bouwketen. De logica-/sockettests gebruiken Node's ingebouwde testmodule en het reeds aanwezige `tsx`. In de oorspronkelijke repository waren geen tests aanwezig.

De browsertest gebruikt Microsoft Edge en start de gebouwde productieapp op **poort 4317**, zodat een andere app op de standaardpoort 3000 niet wordt geraakt. Op machines zonder Edge: verwijder `channel: "msedge"` uit de testconfig en installeer Chromium met `npm exec -- playwright install chromium`. Traces en screenshots staan in het genegeerde `test-results/` onder deze spelmap.

De tests controleren alle **1.596 kaartparen**, privéhanden, correcte en foutieve zetten, cooldown, dubbelklik, acht gelijktijdige klikken, oude round-ID's, punten, nieuwe rondes, winnaar, rematch, hostmigratie, verwijderen en reconnect. Ze controleren ook Tic-Tac-Toe met dezelfde room- en WebSocket-infrastructuur. De browsercontrole gebruikt acht aparte sessies, mobiele viewports, chat, twee Dobble-games, reconnect/refresh en daarna Tic-Tac-Toe in dezelfde room.

## Bestaande platformbeperkingen, bewust buiten scope

Controle uitgevoerd op 1 oktober 2026: volledige monorepo-build geslaagd, expliciete client-TypeScript-controle geslaagd, **12 Node-tests geslaagd** en de productie-browsercyclus met **8 geïsoleerde sessies geslaagd**. Beide kaarten passen binnen de geteste mobiele viewport van 390 × 844; alle symboolknoppen meten minimaal 44 × 44 pixels. Screenshots zijn visueel nagekeken. Tijdens de succesvolle browsercyclus zijn geen JavaScript-runtimefouten of console-errors geregistreerd. De bestaande Tic-Tac-Toe-bestanden, lobby, chat, protocolberichten en server-startup zijn ongewijzigd.

De standaardpoort 3000 werd op deze machine al door een ander spel gebruikt. De browsertest draait daarom op een aparte poort, zonder die app te stoppen. Wil je de gebouwde versie ook op die poort openen, gebruik dan in PowerShell vanuit de repository-root:

```powershell
$env:PORT = "4317"
npm start
```

Open vervolgens `http://localhost:4317`. Voor een ander apparaat op hetzelfde netwerk gebruik je het LAN-adres van deze computer met poort 4317. Er is geen publiek domein gepubliceerd.

- Rejoin gebruikt een publiek player-ID en roomcode, zonder geheim sessietoken. Dat is de bestaande trust-based identiteit; er is geen auth/security-refactor uitgevoerd.
- Offline seats blijven in een room zolang andere spelers verbonden zijn; alleen een volledig offline room wordt na de bestaande 30 seconden verwijderd. De integratie voegt geen apart verloopbeleid toe.
- Bij game-over verwijdert het platform de runtime. Verversen op het eindscherm brengt je daarom terug naar de lobby. Reconnect tijdens een lopende Dobble-game behoudt de state.
- Uitnodigen werkt met de bestaande roomcode. De huidige platformversie bevat geen deelbare join-link; er is geen nieuwe landing/routerflow gemaakt.
- De bestaande Vite 5/esbuild-ontwikkelafhankelijkheden hebben twee auditmeldingen (één hoog, één matig). Die bestonden vóór de integratie. Een framework-upgrade valt buiten deze opdracht en is niet uitgevoerd.

Fysieke apparaten, wifi/firewall en publieke TLS-hosting zijn niet met deze geautomatiseerde tests bewezen. Het bestaande WebSocket-pad `/ws` gebruikt bij HTTPS automatisch `wss://`. Docker was niet geïnstalleerd op de testmachine; de bestaande containeropzet is behouden.

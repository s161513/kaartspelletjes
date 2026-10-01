# Classroom Games

A small webapp for playing real-time games with a group (built for a class).
It's a generic **lobby + rooms + chat** framework over WebSockets, with
**tic-tac-toe** as the first game. New games plug in by implementing one
interface.

## Stack

- **Backend:** Node.js + [`ws`](https://github.com/websockets/ws) + Express
  (in-memory rooms, nickname + room-code join, no accounts).
- **Frontend:** plain HTML pages + a TypeScript WebSocket client, bundled with
  Vite.
- **Shared:** an npm-workspaces monorepo so the message protocol types are
  shared between client and server.

```
shared/   protocol.ts, game.ts – WebSocket message types + the Game/GamePage contract
          cards.ts             – decks, shuffle, deal
server/   src/                 – Express + ws, rooms, handlers, games/loader.ts
client/   *.html + src/        – landing, lobby, one game.html for every game
games/    <id>/                – one folder per game (see "Adding a game")
```

Every game lives in its own folder under `games/`. The server scans that folder
at startup (`server/src/games/loader.ts`) and the client finds the games at build
time with Vite's `import.meta.glob` (`client/src/catalog.ts`), so there is no
central list to edit. A shared `client/src/gameHost.ts` owns the common page
chrome (socket, chat, status, back, reconnect) so each game view stays tiny.

## Develop

```bash
npm install          # installs all workspaces
npm run dev          # server on :3000, Vite client on :5173 (proxies /ws)
```

Open http://localhost:5173 in two tabs:

1. Tab A: enter a nickname → **Create a room** → note the room code.
2. Tab B: enter a nickname → paste the code → **Join room**.
3. Both see each other; chat works both ways.
4. Host clicks **Start Tic-tac-toe** → both land on the board; take turns.
5. Reloading a tab mid-game auto-rejoins the same seat and board.

## Build & run (production)

```bash
npm run build        # builds the client, compiles the server
npm start            # single server on :3000 serving pages + /ws
```

## Docker (client + server in one image)

The multi-stage `Dockerfile` builds all workspaces and ships a lean runtime that
runs the Node server, which also serves the built client and the `/ws` WebSocket
on one port.

```bash
docker build -t classroom-games .
docker run --rm -p 3000:3000 classroom-games
# then open http://localhost:3000
```

Override the port with `-e PORT=8080 -p 8080:8080`. The image runs as a non-root
user and has a `/health` healthcheck.

## Adding a game

Every game is built by one person on its own branch, inside its own folder.
You never edit files outside `games/<id>/`, so branches don't conflict.

### 1. Get set up (once)

Requires Node.js 20+ and npm.

```bash
git clone <repo-url>
cd kaartspelletjes
npm install
npm run dev          # check that tic-tac-toe works at http://localhost:5173
```

### 2. Start your game

```bash
git checkout main && git pull
git checkout -b game/<id>            # e.g. game/pesten
cp -r games/_template games/<id>
```

Pick a short lowercase `<id>` without spaces (e.g. `pesten`, `klaverjassen`)
and set `id` in `games/<id>/meta.ts` to exactly that folder name.

### 3. Build it

Fill in the four files in your folder:

| File | What goes in it | Runs on |
|---|---|---|
| `meta.ts` | title, description, min/max players | both |
| `types.ts` | the shape of your game state and moves | both |
| `logic.ts` | the rules: `init`, `validateMove`, `applyMove`, `result` | server |
| `view.ts` | drawing the game: `mount`, `update`, `onGameOver` | browser |

The template is a small working card game ("highest card wins"); read its
comments first. Card helpers (`createDeck`, `shuffle`, `deal`, `sortHand`, …)
come from `@app/shared`.

Optional extras in your folder:

- **HTML + CSS for the layout.** Put the static markup in `view.html` and your
  styles in `style.css`, and load them from `view.ts`:
  ```ts
  import html from "./view.html?raw";
  import "./style.css";
  // in mount(): ctx.container.innerHTML = html;
  ```
  Prefix your CSS classes with your game id (e.g. `.pesten-hand`) so they
  don't clash with other games.
- **Hidden information.** Add `playerView(state, playerId)` to `logic.ts` to
  decide what each player receives (e.g. replace other players' cards with
  `null`, leave out the deck). Without it everyone gets the full state.
- **Players leaving.** Every game page has a "Leave game" button. Add
  `playerLeft(state, playerId)` to `logic.ts` to keep the game going without
  them (e.g. fold their hand). Without it the game ends when someone leaves,
  and if only one player remains they win.
- **Player names.** `ctx.nickname(playerId)` in `view.ts`.
- **Tests.** Any `games/<id>/*.test.ts` file runs with `npm test`
  (Node's built-in test runner; see `games/tictactoe/tictactoe.test.ts`).

Good to know:

- **The server decides.** Check everything in `validateMove` (whose turn,
  is the move allowed); never trust what the browser sends.
- **Keep state plain JSON**: objects, arrays, strings, numbers. No `Map`,
  `Set` or classes — the state is sent over the WebSocket.
- **Every player receives the full state** unless you add `playerView`
  (see above) — without it, other players' hands are visible in devtools.
- Restart `npm run dev` after creating a new game folder, then test with two
  browser tabs (see [Develop](#develop)).

### 4. Stay up to date

Pull in changes from `main` regularly so you notice problems early:

```bash
git fetch
git merge origin/main
```

### 5. Get it merged

```bash
npm test && npm run build            # must succeed
git push -u origin game/<id>
```

Open a pull request to `main`. Your PR should only touch `games/<id>/`.

### Changing the framework

Need something in the shared code (lobby, server, `shared/`, `gameHost.ts`)?
Don't change it on your game branch. Make a separate branch
(`framework/<what>`), open a small PR for it, and merge `main` back into your
game branch once it's in. That way every change to shared code gets seen by
everyone.

Folders starting with `_` are ignored by the server and the lobby.
`games/_ui/` holds shared view helpers for games, e.g. `renderCard()` from
`games/_ui/cards.ts` for good-looking playing cards (size them with the
`--ui-card-w` CSS variable). Card *data* (`Card`, `createDeck`, …) comes from
`@app/shared`.

## Bullshit / Cheat

Bullshit is automatically discovered from `games/bullshit/`. No manual registry
or second game page is needed. Start it in the existing lobby with **2–8 connected
players**. The platform's generic lobby can hold more seats; Bullshit rejects
starting with more than eight connected players.

The implementation reuses `shared/cards.ts` (`Card`, `Rank`, `Suit`, `deal`,
`shuffle`, `sortHand`), the room manager, WebSocket protocol, shared game host,
chat, session storage, and existing panels/buttons/player styling. Playing cards
use the shared `renderCard()` from `games/_ui/cards.ts`; hidden backs are rendered
with `renderCard(null)` and require no card data.

### Rules

One standard deck (52 cards, no jokers), dealt evenly. The starting player is
random. Each play must contain at least as many cards as the previous set;
a fresh trick starts with a minimum of one card. Choose the claimed rank from
the previous claim minus one, the same rank, or plus one, wrapping cyclically
**A → 2 → … → K → A**. A fresh trick uses A as its anchor (K, A or 2).
The claim is independent of the selected cards: bluffing is allowed. Only the
number and claimed rank are public.

Other players have **3 seconds** to call **BULLSHIT!** on that particular play.
The server checks only the last set. If any card does not match, the player who
played takes the entire pile; otherwise the challenger takes it. The last set
is revealed for 2.4 seconds, then the next player takes the turn. Clearing the
pile resets the minimum to one and the rank anchor to A. An unchallenged play
keeps its chosen claim as the next anchor. If the next player has fewer cards
than the required minimum, the server automatically calls Bullshit for that
player and resolves the claim normally. A player who empties their hand
wins only after the challenge is settled. A caught final bluff does not win.

Timing constants are in `games/bullshit/types.ts`. The four phases are
`TURN`, `CHALLENGE_WINDOW`, `RESOLVING_CHALLENGE`, and `GAME_OVER`.
Round IDs, turn versions, play IDs and server deadlines reject stale/repeated
actions, including packets left over from an earlier round. The server runs
validation, mutation and challenge resolution synchronously.

### Private state and server timers

Bullshit implements the platform's `playerView(state, playerId)`,
`advance(state)` and `nextUpdateIn(state)` hooks. The room manager applies the
same private projection to **start, update, end and rejoin** events. Only the
recipient's `myHand`, other players' card counts, pile count, public claim and
the last challenged set are included. Other hands, hidden pile cards and
unchallenged sets stay server-side. A finished snapshot is retained until the
next game so a refresh can restore the winner screen; finished events include
`gameId` so the shared host opens the matching game view.

**Existing platform limitation, deliberately unchanged:** rejoin authenticates
only with the public player ID and room code. A malicious client can impersonate
a different seat and receive that seat's private view. Per-player projection
prevents broadcasting secrets, but cannot secure identity on its own. Token/auth
changes were explicitly outside this integration's scope. Use this build in a
trusted group until that separate platform issue is addressed. The existing
30-second empty-room grace period, host reassignment, chat, routing, and
connection/session implementation are unchanged. If the player on turn is
offline, Bullshit waits for that player to reconnect.

### Test and demonstrate

```bash
npm test
npm run typecheck
npm run build
npm run dev
```

Open the existing landing page in independent tabs, choose different nicknames,
create/join the same room and select Bullshit. Each tab uses the platform's
existing sessionStorage identity. Refresh a game tab to test reconnect. After
winning, use **Back to lobby**, then start another game.

The main test runner discovers all game tests and the Bullshit/platform tests.
Bullshit tests cover the
shared card utilities, dealing to 2–8 players, rank and turn progression,
selection validation, truthful/mixed/false claims, the full pile pickup, exact
challenge deadlines and races, all final-card cases, hidden-state projections,
round replay rejection, full rounds and rematches. The WebSocket integration test
uses the real loader, room manager and handlers to test 8-player play, reconnect
during challenge resolution, automatic timer expiration, private end/rejoin
events, rematch, and 2-player Bullshit. Tic-tac-toe winner/draw rules and live
WebSocket play are regression-tested. No new dependency stack was introduced.

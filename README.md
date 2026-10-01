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

Good to know:

- **The server decides.** Check everything in `validateMove` (whose turn,
  is the move allowed); never trust what the browser sends.
- **Keep state plain JSON**: objects, arrays, strings, numbers. No `Map`,
  `Set` or classes — the state is sent over the WebSocket.
- **Every player receives the full state**, including other players' hands.
  Fine among friends; just don't show them in `view.ts`.
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
npm run build                        # must succeed
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

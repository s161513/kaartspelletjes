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
shared/   protocol.ts        – WebSocket message types + GAMES catalog (one source of truth)
server/   src/               – Express + ws, rooms, handlers, games/ (game logic)
client/   *.html + src/      – landing, lobby, one page per game + src/games/ renderers
```

Games are pluggable in three matching layers: the shared `GAMES` catalog
(metadata: title, player counts, page), a server game module (`server/src/games/`)
for the rules, and a client renderer + HTML page for the UI. The lobby builds its
picker from the catalog; a shared `client/src/gameHost.ts` owns the common page
chrome (socket, chat, status, back, reconnect) so each game page stays tiny.

## Develop

```bash
npm install          # installs all workspaces
npm run dev          # server on :3000, Vite client on :5173 (proxies /ws)
```

Open http://localhost:5173 in two tabs:

1. Tab A: enter a nickname → **Create a room** → note the room code.
2. Tab B: enter a nickname → paste the code → **Join room**.
3. Both see each other; chat works both ways.
4. Host clicks **Start tic-tac-toe** → both land on the board; take turns.
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

1. Implement the `Game` interface in `server/src/games/<name>.ts`.
2. Register it in `server/src/games/types.ts`.
3. Add its state type to `shared/protocol.ts` and a page to render it.

The lobby/room/chat/reconnect plumbing is reused unchanged.

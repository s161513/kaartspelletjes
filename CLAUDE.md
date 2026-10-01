# CLAUDE.md

Web app for playing (card) games with friends: a generic lobby + rooms + chat
framework over WebSockets, with each game as a plug-in folder. Several people
each build their own game on their own branch.

## Commands

```bash
npm install          # all workspaces
npm run dev          # server :3000 + Vite :5173 → open http://localhost:5173
npm test             # every *.test.ts under games/ (Node test runner via tsx)
npm run build        # shared → games → client → server
npx tsc -p client/tsconfig.json   # typecheck client + game views (Vite doesn't)
```

- Restart `npm run dev` after adding a new game folder; games are discovered at startup.
- Test multiplayer with separate tabs (new tab, incognito or another browser).
  A *duplicated* tab copies sessionStorage and becomes the same player.
- Rooms live in server memory; restarting the server wipes them.

## Layout

```
shared/   protocol.ts  WebSocket message types, GameMeta
          game.ts      the game contract: Game (server) + GamePage/GameContext (browser)
          cards.ts     Card type, createDeck, shuffle, deal, sortHand, RANK_VALUES
server/   src/handlers.ts  message handling (create/join/rejoin/chat/startGame/move/leave)
          src/rooms.ts     rooms, seats, host, prune timer
          src/games/loader.ts  scans games/*/ at startup
client/   game.html + src/gameHost.ts  shared game page: status, chat, leave/back, reconnect
          src/catalog.ts   finds games via import.meta.glob
          src/ws.ts        reconnecting socket, auto-rejoin
games/    <id>/            one folder per game; _template/ is the starting point
```

## How a game works

A game is `games/<id>/` with `meta.ts`, `types.ts`, `logic.ts`, `view.ts`
(optionally `view.html` loaded via `?raw`, `style.css`, `*.test.ts`).

- `logic.ts` (server, authoritative): `init`, `validateMove`, `applyMove`,
  `result`, plus optional hooks — `playerView` (hide private info per player),
  `playerLeft`, and others. **`shared/game.ts` is the source of truth** for the
  full list and their semantics.
- `view.ts` (browser): `mount` once, `update(state)` on every state from the
  server. Use `ctx.sendMove`, `ctx.setStatus`, `ctx.nickname(id)`.
- Move flow: client `move` → `validateMove` → `applyMove` → `result` → each
  player gets their own `playerView` of the new state (or `gameOver`).
- One "game" can span many rounds/hands (poker: until one player has all chips).

## Rules for changes

- **Game work stays inside `games/<id>/`** on branch `game/<id>`. Never edit
  another game's folder.
- **Framework changes** (`shared/`, `server/`, `client/`, root config) go in a
  separate small branch/PR, not mixed into a game branch. Keep new hooks
  optional so existing games keep working.
- `meta.ts` `id` must equal the folder name. Folders starting with `_` are ignored.
- State must be plain JSON (no Map/Set/classes). `validateMove` must not mutate
  state; `applyMove` returns a new state (`structuredClone` is fine).
- `logic.ts` runs only on the server and may use Node APIs; `view.ts` runs in the
  browser and must not import Node-only modules.
- Never send secrets to every player: if other players must not see something
  (hands, deck), implement `playerView`.
- Prefix a game's CSS classes with its id (`.poker-…`). `.card` is already the
  page's panel class. Use `body.<id>-…` classes for page-level overrides.
- Framework UI text is English; a game's own texts are up to its owner.

## Before committing

```bash
npm test && npm run build && npx tsc -p client/tsconfig.json
```

For server behaviour, a quick script with the `ws` package against
`node server/dist/index.js` (create → join → startGame → move) is the most
reliable end-to-end check.

import { resolve } from "node:path";
import { defineConfig } from "vite";

// Multi-page app: one HTML entry per page.
export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    proxy: {
      // Forward WebSocket traffic to the Node server during development.
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/counter-ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        lobby: resolve(__dirname, "lobby.html"),
        // One page for all games; the game comes from ?game=<id>.
        game: resolve(__dirname, "game.html"),
        counter: resolve(__dirname, "counter.html"),
      },
    },
  },
});

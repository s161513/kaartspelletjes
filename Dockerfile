# syntax=docker/dockerfile:1

# ---- Stage 1: build everything (shared -> client -> server) ----
FROM node:22-alpine AS build
WORKDIR /app

# Install all workspace deps using the exact lockfile. Copy manifests first so
# this layer is cached unless dependencies change.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY games/package.json ./games/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# Build: emits shared/dist, games/dist, client/dist, server/dist.
COPY . .
RUN npm run build

# ---- Stage 2: lean runtime (just the Node server, which also serves the SPA) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Production-only deps (express, ws) + the @app/shared workspace symlink.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY games/package.json ./games/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev

# Built artifacts. Keep server/dist and client/dist as siblings under /app so the
# server's static path (../../client/dist from server/dist/index.js) resolves,
# ship shared/dist so the @app/shared symlink points at real JS, and games/dist
# which the server scans for game logic at startup.
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/games/dist ./games/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

USER node
EXPOSE 3000

# Uses Node's built-in global fetch (Node 22) — no extra packages needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]

# syntax=docker/dockerfile:1
# Multi-stage build for Warikan Master.
# Stage 1: install all deps and build client + server bundles.
# Stage 2: slim runtime image with only the production-needed files.

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# build tools required by better-sqlite3 (native module)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
# devDeps (drizzle-kit, tsx) are kept on purpose — needed by `npm run db:push`
# at container startup so the schema is applied on a fresh database.

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
# Default DB path lives under /app/data so the free-plan deploy works without
# a persistent disk. To persist across restarts, mount a disk and override
# DB_PATH (e.g. /data/data.db) — see deploy/render.yaml comments.
ENV DB_PATH=/app/data/data.db

# Tini for proper signal handling (graceful SIGTERM on redeploys).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only what we need to run.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Both default (free-plan, ephemeral) and disk-mount paths.
RUN mkdir -p /app/data /data

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply schema (idempotent) then start the server.
CMD ["sh", "-c", "npm run db:push -- --force && node dist/index.cjs"]

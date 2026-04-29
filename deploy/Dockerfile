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
# at container startup so the schema is applied on a fresh persistent volume.

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000
# Persistent volume mount point — see render.yaml / your platform's disk config.
ENV DB_PATH=/data/data.db

# Tini for proper signal handling (graceful SIGTERM on redeploys).
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only what we need to run.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply schema (idempotent) then start the server.
CMD ["sh", "-c", "npm run db:push -- --force && node dist/index.cjs"]

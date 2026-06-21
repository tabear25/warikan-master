# syntax=docker/dockerfile:1
# Multi-stage build for Warikan Master.
# Stage 1: install all deps and build client + server bundles.
# Stage 2: slim runtime image with only the production-needed files.

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# ca-certificates so npm can fetch over HTTPS. No C toolchain needed:
# @libsql/client ships prebuilt binaries (better-sqlite3 was removed).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
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
# Data lives in a remote Turso/libSQL database so it survives container
# restarts/redeploys/sleep on Render's free tier (the local filesystem is
# ephemeral). The server reads TURSO_DATABASE_URL + TURSO_AUTH_TOKEN at
# runtime — set them in the Render dashboard (see deploy/README.md).
# If those are unset it falls back to a local file DB (dev only).

# Tini for proper signal handling (graceful SIGTERM on redeploys).
# ca-certificates is required for the HTTPS/TLS connection to Turso.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only what we need to run.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply schema to the Turso database (idempotent) then start the server.
CMD ["sh", "-c", "npm run db:push -- --force && node dist/index.cjs"]

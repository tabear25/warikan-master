# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server (Express on port 5000 with Vite HMR) |
| `npm run build` | Production build — Vite compiles client to `dist/public/`, esbuild bundles server to `dist/index.cjs` |
| `npm start` | Run the production server |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Apply Drizzle schema changes to SQLite (`data.db`) |

There is no test runner configured in this project.

### Mobile app (`mobile/`)

| Command (run inside `mobile/`) | Purpose |
|---------|---------|
| `npm install` | Install Expo/React Native deps (separate `package.json` from the web app) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm start` / `npx expo start` | Start the Expo dev server |
| `npm run android` | Launch on an Android emulator/device |
| `npx expo export --platform android` | Build the JS bundle (validates Metro resolution) |
| `npx expo prebuild --platform android` | Generate the native `android/` project for an APK/AAB build |

Native builds (APK/AAB, emulator) cannot run in the cloud sandbox; only `npm install`, `typecheck`, and `expo export` are verifiable here. The Expo API (`api.expo.dev`) is blocked by the network policy, so `npx expo install` fails — pin Expo package versions and install with plain `npm install` instead.

## Architecture

Full-stack TypeScript application: React (client) + Express 5 (server) + SQLite via Drizzle ORM.

**Frontend** (`client/src/`): Hash-based routing via wouter. TanStack React Query v5 handles all server state. The `apiRequest()` helper in [client/src/lib/queryClient.ts](client/src/lib/queryClient.ts) is the single HTTP client used throughout. UI uses shadcn/ui components (Radix UI + Tailwind CSS).

**Backend** (`server/`): All API routes live in [server/routes.ts](server/routes.ts). The `DatabaseStorage` class in [server/storage.ts](server/storage.ts) is the sole database abstraction — all queries go through it, never Drizzle directly from routes. In dev mode, Vite runs as Express middleware (HMR on `/vite-hmr`); in production, Express serves pre-built static files from `dist/public/`.

**Shared schema** (`shared/schema.ts`): Drizzle table definitions and Zod schemas are co-located here and imported by both client and server via the `@shared/*` path alias. `@/*` maps to `client/src/`.

**Database tables**: `events`, `members`, `payments`, `admins`. The `payments.splitMemberIds` column stores a JSON array of member IDs.

**Mobile app** (`mobile/`): A standalone **React Native (Expo SDK 52, Android-first)** app with its own `package.json` — kept separate from the web app to avoid React/dependency conflicts. It reimplements the five screens (`mobile/src/screens/`: Home, Create, Event, Admin, Help) natively, using React Navigation (native stack) instead of wouter, but mirrors the web app's logic and Japanese copy. It talks to the same Express API over HTTP; the base URL is injected via the `EXPO_PUBLIC_API_BASE` env var (`mobile/src/api/client.ts`). React Native's `fetch` is not subject to CORS, so the server needs no changes. The mobile app is **self-contained**: rather than importing `@shared`, the few pure helpers it needs (split algorithm, currency formatting, row types) are copied into `mobile/src/lib/` — keep these in sync with `shared/` if API shapes or the split logic change. Admin credentials are persisted in the device keystore via `expo-secure-store` (`mobile/src/storage/admin.ts`).

## Key Logic

**Settlement algorithm** ([server/routes.ts](server/routes.ts), `calculateSettlement()`): Greedy minimization — computes each member's net balance, then iteratively matches the largest debtor with the largest creditor to produce the minimum number of transfers. Floating-point tolerance is `0.01`.

**Admin authentication**: Credentials are read from env vars — `ADMIN_USERNAME` plus either `ADMIN_PASSWORD` (plaintext, hashed in-memory at startup with bcryptjs) or `ADMIN_PASSWORD_HASH` (a pre-computed bcrypt hash; `ADMIN_PASSWORD` wins if both are set). There are no defaults — `loadAdminConfig()` in [server/auth.ts](server/auth.ts) makes the server fail fast on startup if they are unset, and weak usernames/passwords are rejected. Auth is header-based (`x-admin-username`, `x-admin-password`) — no session cookies.

## Deployment

**This project is deployed on Render** (Docker runtime via [deploy/render.yaml](deploy/render.yaml)). Assume Render as the deployment target — do NOT implement features or infrastructure on the assumption of any other platform (Vercel, Netlify, Heroku, raw VPS, etc.) unless explicitly told otherwise.

Render-specific constraints to keep in mind:
- **Docker-based**: the image is built from [deploy/Dockerfile](deploy/Dockerfile) with `dockerContext: .`. Build/runtime changes must work inside that Dockerfile, not just locally.
- **Secrets**: `ADMIN_USERNAME` / `ADMIN_PASSWORD` use `sync: false` — they are entered in the Render dashboard, never committed.
- **autoDeploy** is enabled: pushes to the tracked branch trigger a redeploy.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5000` | Server listen port |
| `NODE_ENV` | — | `development` enables Vite HMR; `production` serves static files |
| `ADMIN_USERNAME` | — (required) | Admin login username |
| `ADMIN_PASSWORD` | — | Admin login password (plaintext; hashed at startup). Set this or `ADMIN_PASSWORD_HASH` |
| `ADMIN_PASSWORD_HASH` | — | Pre-computed bcrypt hash of the admin password (alternative to `ADMIN_PASSWORD`) |
| `EXPO_PUBLIC_API_BASE` | `""` | (mobile only) Base URL of the backend the Android app connects to, e.g. `https://<service>.onrender.com`. Inlined at build time. |
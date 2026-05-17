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

## Architecture

Full-stack TypeScript application: React (client) + Express 5 (server) + SQLite via Drizzle ORM.

**Frontend** (`client/src/`): Hash-based routing via wouter. TanStack React Query v5 handles all server state. The `apiRequest()` helper in [client/src/lib/queryClient.ts](client/src/lib/queryClient.ts) is the single HTTP client used throughout. UI uses shadcn/ui components (Radix UI + Tailwind CSS).

**Backend** (`server/`): All API routes live in [server/routes.ts](server/routes.ts). The `DatabaseStorage` class in [server/storage.ts](server/storage.ts) is the sole database abstraction — all queries go through it, never Drizzle directly from routes. In dev mode, Vite runs as Express middleware (HMR on `/vite-hmr`); in production, Express serves pre-built static files from `dist/public/`.

**Shared schema** (`shared/schema.ts`): Drizzle table definitions and Zod schemas are co-located here and imported by both client and server via the `@shared/*` path alias. `@/*` maps to `client/src/`.

**Database tables**: `events`, `members`, `payments`, `admins`. The `payments.splitMemberIds` column stores a JSON array of member IDs.

## Key Logic

**Settlement algorithm** ([server/routes.ts](server/routes.ts), `calculateSettlement()`): Greedy minimization — computes each member's net balance, then iteratively matches the largest debtor with the largest creditor to produce the minimum number of transfers. Floating-point tolerance is `0.01`.

**Admin authentication**: Credentials are read from env vars — `ADMIN_USERNAME` plus either `ADMIN_PASSWORD` (plaintext, hashed in-memory at startup with bcryptjs) or `ADMIN_PASSWORD_HASH` (a pre-computed bcrypt hash; `ADMIN_PASSWORD` wins if both are set). There are no defaults — `loadAdminConfig()` in [server/auth.ts](server/auth.ts) makes the server fail fast on startup if they are unset, and weak usernames/passwords are rejected. Auth is header-based (`x-admin-username`, `x-admin-password`) — no session cookies.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5000` | Server listen port |
| `NODE_ENV` | — | `development` enables Vite HMR; `production` serves static files |
| `ADMIN_USERNAME` | — (required) | Admin login username |
| `ADMIN_PASSWORD` | — | Admin login password (plaintext; hashed at startup). Set this or `ADMIN_PASSWORD_HASH` |
| `ADMIN_PASSWORD_HASH` | — | Pre-computed bcrypt hash of the admin password (alternative to `ADMIN_PASSWORD`) |
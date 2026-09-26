# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server (Express on port 5000 with Vite HMR) |
| `npm run build` | Production build — Vite compiles client to `dist/public/`, esbuild bundles server to `dist/index.cjs` |
| `npm start` | Run the production server |
| `npm run check` | TypeScript type checking |
| `npm run db:generate` | Generate a migration in `migrations/` from a `shared/schema.ts` change |
| `npm run db:push` | Push the schema straight to the DB — **throwaway local DBs only, see the warning below** |
| `npm test` | Run the vitest suite (`shared/split`, `server/settlement` — which also covers `shared/settlement` incl. partial settlement, `client/src/lib/export`, `tests/api`) |

> **Never run `db:push` against a database the server will start against — including the production Turso DB.** Schema is normally applied by the server itself at startup (`server/index.ts` runs `migrate()`, and `deploy/Dockerfile`'s `CMD` is just `node dist/index.cjs`). `drizzle-kit push` changes the schema *without* writing `__drizzle_migrations`, so the next startup replays the same `ALTER TABLE` and dies on `duplicate column name`. To change the schema, run `db:generate` and commit the migration.

Tests run on **vitest** (`npm test`, config in [vitest.config.ts](vitest.config.ts)). Coverage is narrow — the split algorithm, the settlement calculation, the export formatters and the API routes — there are no component or end-to-end tests.

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

Full-stack TypeScript application: React (client) + Express 5 (server) + libSQL/SQLite via Drizzle ORM. In production the database is **Turso** (cloud libSQL), reached with `@libsql/client` and configured via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`. This keeps data persistent on Render's free tier, whose container filesystem is ephemeral. When those env vars are unset (local dev), `server/storage.ts` falls back to a local SQLite file (`DB_PATH`, default `data.db`). Note libSQL's Drizzle client is **async** — `.get()/.all()/.run()` and `db.transaction()` return Promises, so `await` them.

**Frontend** (`client/src/`): Hash-based routing via wouter. TanStack React Query v5 handles all server state. The `apiRequest()` helper in [client/src/lib/queryClient.ts](client/src/lib/queryClient.ts) is the single HTTP client used throughout. UI uses shadcn/ui components (Radix UI + Tailwind CSS).

**Backend** (`server/`): All API routes live in [server/routes.ts](server/routes.ts). The `DatabaseStorage` class in [server/storage.ts](server/storage.ts) is the sole database abstraction — all queries go through it, never Drizzle directly from routes. In dev mode, Vite runs as Express middleware (HMR on `/vite-hmr`); in production, Express serves pre-built static files from `dist/public/`.

**Shared schema** (`shared/schema.ts`): Drizzle table definitions and Zod schemas are co-located here and imported by both client and server via the `@shared/*` path alias. `@/*` maps to `client/src/`.

**Database tables**: `events`, `members`, `payments`, `schedule_items`, `partial_settlements`. The `payments.splitMemberIds` column stores a JSON array of member IDs; `payments.partialSettlementId` (nullable) points at the partial settlement the payment was settled early in.

**Payout preference**: `members.payoutPreference` (nullable, `bank` / `paypay` / `cash` / `any`) records how a member wants to be paid back; it is shown on the member chips and under each row of the settlement transfer list. The only entry point is tapping a member chip, so unset chips carry a faded wallet icon and a one-line hint sits under the members bar and under the transfer list — both vanish once any member has a value set. The feature is documented in the help page FAQ (`payout-preference` / `payout-privacy` in [client/src/pages/help.tsx](client/src/pages/help.tsx)); keep that copy in step with the UI. **Deliberately stores the method only — never an account number, a PayPay ID, or any other concrete handle.** Anyone who knows the event keyword can read and edit every member's value (the app never binds a device to a person), so nothing that would hurt if leaked belongs in this column. Do not "improve" this by adding a free-text detail field without revisiting that trade-off. Editing stays allowed on settled events, because transfers happen *after* settlement.

**Trip schedule feature**: `events.type` (`trip` / `meal` / `other`, default `other`) gates the trip-itinerary feature — only `trip` events show the schedule tab. `schedule_items` holds accommodation / transport / other entries; per-category details (mode, from/to, reservation number, …) live in its `metadata` JSON column so new categories need no schema change. A schedule item converts into a payment via `POST /api/events/:id/payments` with an optional `scheduleItemId` — this links both sides bidirectionally (`payments.schedule_item_id` ↔ `schedule_items.payment_id`) in a transaction; deleting either side only clears the link on the other. Schedule editing stays allowed on settled events (only the payments side is locked). Requirements + implementation decisions: [docs/travel-feature-requirements.md](docs/travel-feature-requirements.md) §11.

**Partial settlement（部分精算）**: settles a chosen subset of payments ahead of the rest — the motivating case is a trip three months out where the hotel and flights were booked (and paid by one or two people) long before the trip. `POST /api/events/:id/partial-settlements` (`{ paymentIds }`) creates a `partial_settlements` row and stamps `payments.partialSettlementId` in one transaction; the UPDATE only touches payments of that event that are still unsettled, and a `rowsAffected` mismatch rolls the whole thing back (409), so two people cannot settle the same payment twice. `DELETE /api/events/:id/partial-settlements/:partialId` undoes it (payments go back to unsettled). Both are general routes, like settle / unsettle. A settled-early payment cannot be edited or deleted (400) until its partial settlement is undone, because its transfers may already have been paid; the rule is enforced in storage too (`updatePayment` / `deletePayment` only touch rows whose `partial_settlement_id IS NULL` and throw `PaymentSettledEarlyError` otherwise), so a partial settlement committing between the route's check and the write cannot slip an edit through. The event itself stays open, so payments made during the trip can still be added. The event page refetches payments and the settlement on window focus (`refetchOnWindowFocus: "always"`), so a device that was left open does not keep showing — and exporting — transfers that someone already settled early. Undoing is refused while the whole event is settled. Transfers are **not stored** — `GET /api/events/:id/settlement` recomputes them: `transfers` / `balances` now mean the **remaining** (not-yet-settled) payments, and `partialSettlements[]` carries each batch's `paymentIds`, `total`, `transfers` and `balances` (`calculateSettlementWithPartials()` in [shared/settlement.ts](shared/settlement.ts)). Every batch's balances sum to zero, so settling in batches never changes anyone's overall net position; only the number of transfers can grow. Events without partial settlements get exactly the previous response plus `partialSettlements: []`. The web UI lives in the settlement section of [client/src/pages/event.tsx](client/src/pages/event.tsx) (`PartialSettlementDialog`, `PartialSettlementHistory`, and `TransferList`, which both the remaining list and each batch use); the dialog previews transfers with the same `calculateSettlement()` the server uses, and for trip events offers a one-tap "宿泊・移動をまとめて選ぶ" based on the payment's linked schedule item category. Help FAQ: `partial-settlement`.

**Mobile app** (`mobile/`): A standalone **React Native (Expo SDK 52, Android-first)** app with its own `package.json` — kept separate from the web app to avoid React/dependency conflicts. It reimplements the five screens (`mobile/src/screens/`: Home, Create, Event, Admin, Help) natively, using React Navigation (native stack) instead of wouter, but mirrors the web app's logic and Japanese copy. It talks to the same Express API over HTTP; the base URL is injected via the `EXPO_PUBLIC_API_BASE` env var (`mobile/src/api/client.ts`). React Native's `fetch` is not subject to CORS, so the server needs no changes. The mobile app is **self-contained**: rather than importing `@shared`, the few pure helpers it needs (split algorithm, currency formatting, row types) are copied into `mobile/src/lib/` — keep these in sync with `shared/` if API shapes or the split logic change. The trip-schedule feature (`events.type`, `schedule_items`, OGP) is web-only for now; all related API fields are optional, so the mobile app keeps working unchanged. Partial settlement is web-only too: the mobile app reads only `transfers` / `balances` from `/settlement`, so it shows the remaining settlement correctly, but it does not mark settled-early payments — editing or deleting one there fails with the server's 400 message. Admin credentials are persisted in the device keystore via `expo-secure-store` (`mobile/src/storage/admin.ts`).

## Key Logic

**Settlement algorithm** ([shared/settlement.ts](shared/settlement.ts), `calculateSettlement()`, re-exported by [server/settlement.ts](server/settlement.ts)): Greedy minimization — computes each member's net balance, then iteratively matches the largest debtor with the largest creditor to produce the minimum number of transfers. Balances are whole yen and every payment's shares sum to its total, so the balances sum to exactly zero and the matching needs no float tolerance. Each row of the transfer list expands on tap (single-open accordion) into the sender's derivation: 立替合計 − 負担合計 = その人の収支, plus a per-payment table. That detail must stay exact, so the client reuses the server's own share allocation and settlement: `computeShares()` lives in [shared/split.ts](shared/split.ts), `calculateSettlement()` in [shared/settlement.ts](shared/settlement.ts), and [server/settlement.ts](server/settlement.ts) re-exports both — never reimplement them on the client.

**Settling and un-settling**: `POST /api/events/:id/settle` and `POST /api/events/:id/unsettle` are both **general routes** — anyone with the keyword can settle and un-settle, matching the rest of the app's access model. Settling locks payment/member writes, so leaving the reverse admin-only stranded users with no recovery path. The admin route `PATCH /api/admin/events/:id/settlement` is kept for operations. Destructive actions stay admin-only: deleting an event (`DELETE /api/admin/events/:id`) and deleting a member (`DELETE /api/admin/events/:id/members/:memberId`).

**OGP fetcher** ([server/ogp.ts](server/ogp.ts), backing `POST /api/ogp`): resolves og:title / description / image for schedule-item URLs. SSRF-guarded — http/https only, private / link-local IPs rejected at DNS-resolution time, redirects re-validated per hop (max 3), 3s timeout, 512KB body cap, 30 req/min/IP rate limit, in-memory cache. OGP failures must never block saving an item; the client treats errors as "no metadata".

**Admin authentication**: Credentials are read from env vars — `ADMIN_USERNAME` plus either `ADMIN_PASSWORD` (plaintext, hashed in-memory at startup with bcryptjs) or `ADMIN_PASSWORD_HASH` (a pre-computed bcrypt hash; `ADMIN_PASSWORD` wins if both are set). There are no defaults — `loadAdminConfig()` in [server/auth.ts](server/auth.ts) makes the server fail fast on startup if they are unset, and weak usernames/passwords are rejected. Auth is header-based (`x-admin-username`, `x-admin-password`) — no session cookies.

## Deployment

**This project is deployed on Render** (Docker runtime via [deploy/render.yaml](deploy/render.yaml)). Assume Render as the deployment target — do NOT implement features or infrastructure on the assumption of any other platform (Vercel, Netlify, Heroku, raw VPS, etc.) unless explicitly told otherwise.

Render-specific constraints to keep in mind:
- **Docker-based**: the image is built from [deploy/Dockerfile](deploy/Dockerfile) with `dockerContext: .`. Build/runtime changes must work inside that Dockerfile, not just locally.
- **Secrets**: `ADMIN_USERNAME` / `ADMIN_PASSWORD` and `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` use `sync: false` — they are entered in the Render dashboard, never committed.
- **autoDeploy** is enabled: pushes to the tracked branch trigger a redeploy.
- **Persistence**: data lives in Turso (cloud libSQL), not on the container disk, because Render's free tier has no persistent disk. See [deploy/README.md](deploy/README.md) for Turso setup.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `5000` | Server listen port |
| `NODE_ENV` | — | `development` enables Vite HMR; `production` serves static files |
| `TURSO_DATABASE_URL` | — | Turso/libSQL connection URL (`libsql://...`). Set in production for persistent data |
| `TURSO_AUTH_TOKEN` | — | Turso auth token (paired with `TURSO_DATABASE_URL`) |
| `DB_PATH` | `data.db` | Local SQLite file path used only when `TURSO_*` is unset (dev fallback) |
| `ADMIN_USERNAME` | — (required) | Admin login username |
| `ADMIN_PASSWORD` | — | Admin login password (plaintext; hashed at startup). Set this or `ADMIN_PASSWORD_HASH` |
| `ADMIN_PASSWORD_HASH` | — | Pre-computed bcrypt hash of the admin password (alternative to `ADMIN_PASSWORD`) |
| `EXPO_PUBLIC_API_BASE` | `""` | (mobile only) Base URL of the backend the Android app connects to, e.g. `https://<service>.onrender.com`. Inlined at build time. |
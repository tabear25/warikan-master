import { defineConfig } from "drizzle-kit";

// Treat empty/whitespace-only env vars as unset, matching server/storage.ts so
// `db:push` and the running server resolve the same connection target.
const cleanEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  // libSQL/Turso dialect — works against both a remote Turso database
  // (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) and a local file: URL for dev.
  dialect: "turso",
  dbCredentials: {
    url:
      cleanEnv(process.env.TURSO_DATABASE_URL) ??
      `file:${process.env.DB_PATH ?? "./data.db"}`,
    authToken: cleanEnv(process.env.TURSO_AUTH_TOKEN),
  },
});

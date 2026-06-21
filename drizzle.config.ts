import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  // libSQL/Turso dialect — works against both a remote Turso database
  // (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) and a local file: URL for dev.
  dialect: "turso",
  dbCredentials: {
    url:
      process.env.TURSO_DATABASE_URL ??
      `file:${process.env.DB_PATH ?? "./data.db"}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});

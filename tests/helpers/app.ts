import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { registerRoutes } from "../../server/routes";
import { loadAdminConfig } from "../../server/auth";
import { DatabaseStorage, type IStorage, type Database } from "../../server/storage";

export interface TestApp {
  app: express.Express;
  storage: IStorage;
  db: Database;
}

// 使い捨ての libSQL に本物のマイグレーションを適用してルート一式を組み立てる。
// スキーマの単一情報源（migrations/）をテストでも使い、マイグレーション自体も
// 毎回検証されるようにする。
// 注: ":memory:" は使わない — @libsql/client のローカル実装はトランザクションで
// 別コネクションを張るため、インメモリ DB だと空の DB を見てしまう。
export async function createTestApp(): Promise<TestApp> {
  const dbPath = path.join(os.tmpdir(), `warikan-api-test-${randomUUID()}.db`);
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as Database;
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "migrations"),
  });

  loadAdminConfig();

  const storage = new DatabaseStorage(db);
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app, storage);

  // server/index.ts のグローバルエラーハンドラと同じ形状。
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || "Internal Server Error" });
  });

  return { app, storage, db };
}

export const ADMIN_HEADERS = {
  "x-admin-username": process.env.ADMIN_USERNAME ?? "",
  "x-admin-password": process.env.ADMIN_PASSWORD ?? "",
};

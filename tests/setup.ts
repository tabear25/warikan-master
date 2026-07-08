import os from "os";
import path from "path";
import { randomUUID } from "crypto";

// server/storage.ts はモジュールロード時に DB クライアントを作るため、
// 実データ (data.db) に触れないよう先に退避先を指定しておく。
process.env.DB_PATH = path.join(os.tmpdir(), `warikan-test-${randomUUID()}.db`);
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

// loadAdminConfig() 用のテスト資格情報（auth.ts の弱パスワード拒否を通る値）。
process.env.ADMIN_USERNAME = "testadmin";
process.env.ADMIN_PASSWORD = "test-password-123";

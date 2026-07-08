import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "path";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { loadAdminConfig } from "./auth";
import { db } from "./storage";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// Render などのリバースプロキシ配下で req.ip を正しく取得する（レート制限のため）。
app.set("trust proxy", 1);

// セキュリティヘッダ。CSP は本番のみ有効にする（開発では Vite の HMR /
// react-refresh がインラインスクリプトと eval を必要とするため）。
const isProd = process.env.NODE_ENV === "production";
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Tailwind 由来のインラインスタイルと Google Fonts の CSS を許可。
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            // OGP サムネイル（任意の https ホスト）と QR コードの data: URL。
            imgSrc: ["'self'", "data:", "https:"],
            // html-to-image の精算画像エクスポートがフォント CSS/woff を fetch する。
            connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
          },
        }
      : false,
    // 外部画像（OGP サムネイル）の埋め込みを妨げないよう COEP は無効のまま。
    crossOriginEmbedderPolicy: false,
  }),
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // 管理者認証情報を起動時に検証する。不正・未設定ならプロセスを終了する（fail-fast）。
  try {
    loadAdminConfig();
  } catch (err) {
    console.error(
      `[起動中止] ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // スキーマのマイグレーションを起動時に適用する（冪等・適用済みは journal で
  // スキップ）。以前の「コンテナ起動毎に db:push --force」は破壊的変更を無警告で
  // 本番 Turso に流すリスクがあったため、レビュー可能な生成マイグレーションに移行。
  try {
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "migrations"),
    });
    log("database migrations applied", "storage");
  } catch (err) {
    console.error(
      `[起動中止] マイグレーションに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      // reusePort は Windows では未サポートで ENOTSUP になるため、Windows 以外でのみ有効化する
      reusePort: process.platform !== "win32",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

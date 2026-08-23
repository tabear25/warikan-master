import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Vite が /assets 配下に出すファイル名は内容ハッシュ付きなので、内容が変われば
  // 必ず URL も変わる。1 年の immutable を付けて再訪時の条件付き GET をなくす。
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );

  // それ以外（index.html、favicon、manifest、og 画像など）はハッシュを持たないので
  // 都度検証させる。ETag は express.static の既定で付く。
  app.use(express.static(distPath, { maxAge: 0, etag: true }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    // SPA のエントリは常に最新を取らせる（キャッシュされると新しい /assets を
    // 指さない古い HTML が残り続ける）。
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

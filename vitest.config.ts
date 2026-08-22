import { defineConfig } from "vitest/config";
import path from "path";

// vite.config.ts は root: client/ のため流用せず、テスト専用の設定を持つ。
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
      "tests/**/*.test.ts",
      // クライアント側の純粋関数（lib/）もここで拾う。DOM を触るものは対象外
      // （environment は node のまま）。
      "client/src/lib/**/*.test.ts",
    ],
    setupFiles: ["tests/setup.ts"],
  },
});

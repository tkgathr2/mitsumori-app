import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// tsconfig の paths（"@/*": ["./*"]）を vitest でも解決する。
// これが無いと lib/prices.ts の `@/data/...` import がテストで読めない。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // server-only は react-server 条件下でのみ空モジュールになる。
      // テスト（通常の Node 解決）では index.js が throw するため空に差し替える。
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url)
      ),
    },
  },
});

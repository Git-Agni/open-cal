import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  // `server-only` throws outside a React Server build; the unit tests run plain Node.
  resolve: { alias: { "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) } },
});

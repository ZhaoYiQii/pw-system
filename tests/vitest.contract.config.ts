import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pw/database": path.join(here, "../packages/database/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["tests/contract/**/*.spec.ts"]
  }
});

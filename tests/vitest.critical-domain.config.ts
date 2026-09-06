import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pw/database": path.join(here, "../packages/database/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/money-state-critical.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: [
        "apps/api/src/common/money.ts",
        "apps/api/src/modules/ledger/domain/split.ts",
        "apps/api/src/modules/orders/domain/order-state-machine.ts",
      ],
      thresholds: {
        statements: 100,
        functions: 100,
        lines: 100,
        branches: 100,
      },
    },
  },
});

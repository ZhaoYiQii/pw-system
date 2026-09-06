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
    include: [
      "tests/integration/orders.spec.ts",
      "tests/integration/order-state-machine.spec.ts",
      "tests/integration/dispatch-concurrency.spec.ts",
      "tests/integration/session-idempotency.spec.ts",
      "tests/integration/finance-rules.spec.ts",
      "tests/integration/ledger-invariants.spec.ts",
      "tests/integration/settlement-concurrency.spec.ts",
      "tests/integration/audit-coverage.spec.ts",
    ],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_test?schema=public",
      PLATFORM_DATABASE_URL:
        process.env.PLATFORM_DATABASE_URL ??
        "postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_test?schema=public",
      SESSION_SECRET:
        process.env.SESSION_SECRET ??
        "test-secret-0123456789-0123456789-0123456789",
      PW_TEST_MIGRATION_URL:
        process.env.PW_TEST_MIGRATION_URL ??
        "postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_test?schema=public",
      PW_TEST_RUNTIME_URL:
        process.env.PW_TEST_RUNTIME_URL ??
        "postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas_test?schema=public",
    },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});

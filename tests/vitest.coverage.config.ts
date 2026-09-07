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
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["apps/api/src/**/*.ts"],
      exclude: [
        "**/*.spec.ts",
        "apps/api/src/openapi/**",
        "apps/api/src/main.ts",
      ],
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        branches: 60,
      },
    },
    environment: "node",
    include: ["tests/integration/**/*.spec.ts", "apps/api/src/**/*.spec.ts"],
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

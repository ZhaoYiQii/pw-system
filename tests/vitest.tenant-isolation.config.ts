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
    include: ["tests/tenant-isolation/**/*.spec.ts"],
    env: {
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

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
    include: ["tests/integration/**/*.spec.ts"],
    /**
     * 连接预算：`@prisma/adapter-pg` 为每个 client 建一个 pg Pool（默认 max=10），
     * 而每个用例文件会持有 2 个 client（测试直连 + Nest 应用）。
     * 本地 16 核机器默认可并行 ~15 个文件，峰值会撞上 Postgres 的 100 连接上限，
     * 表现为偶发 500（remaining connection slots are reserved...）。
     * 固定 4 个 worker 与 CI 运行器规模一致，峰值连接数留出余量。
     */
    maxWorkers: 4,
    env: {
      PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER ?? "mock",
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

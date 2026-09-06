import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/src/**/*.spec.ts",
      "apps/worker/src/**/*.spec.ts"
    ],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://pw_runtime:pw_runtime_dev_only@127.0.0.1:5433/pw_saas?schema=public",
      PLATFORM_DATABASE_URL:
        process.env.PLATFORM_DATABASE_URL ??
        "postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas?schema=public"
    }
  }
});

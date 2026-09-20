import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    channel: "msedge",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      use: { baseURL: process.env.ADMIN_ORIGIN ?? "http://localhost:3005" },
    },
    {
      // 算价模型 Task 5：报单/结算相关页面的走查用例（含视觉基线）。
      // 需要先跑 `work/s5c-walkthrough-seed.mjs scenario` 造夹具；商家端建议用生产构建启动
      // （本地 next dev 在部分环境里水合不完整，登录点击会无效）。
      name: "pricing-slot-report",
      testMatch: /pricing-slot-report\.spec\.ts/,
      use: {
        baseURL: process.env.ADMIN_ORIGIN ?? "http://localhost:3005",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-h5",
      testMatch: /mobile\.spec\.ts/,
      use: { baseURL: process.env.H5_ORIGIN ?? "http://localhost:3101" },
    },
    {
      // 跨入口用例：同时驱动商家端(3005)与客户 H5(3101)，所以单独一个 project。
      name: "cross-entry",
      testMatch: /customer-self-service\.spec\.ts/,
      use: { baseURL: process.env.ADMIN_ORIGIN ?? "http://localhost:3005" },
    },
  ],
});

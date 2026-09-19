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

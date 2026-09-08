import { expect, test } from "@playwright/test";

test("商家端设置页提供五个分区与配置版本回滚", async ({ page }) => {
  await page.goto("/merchant-console/settings");

  await expect(page.getByRole("heading", { name: "门店设置" })).toBeVisible();
  await expect(page.locator(".mc-settings-tabs button")).toHaveCount(5);

  await page.getByRole("tab", { name: "配置版本" }).click();
  await expect(page.locator(".mc-version-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "回滚到此版本" }),
  ).toBeVisible();
});

test("店长直连门店设置被角色 403 拦截", async ({ page }) => {
  await page.goto("/merchant-console/settings?role=ADMIN");

  await expect(
    page.getByRole("heading", { name: "无权访问 · 403" }),
  ).toBeVisible();
});

test("工作台可发布待发布草稿", async ({ page }) => {
  await page.goto("/merchant-console/work");

  await page.getByRole("tab", { name: "待发布", exact: true }).click();
  await page.getByRole("link", { name: "去发布", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant-console\/dispatch\/27$/);

  await page
    .locator(".mc-state-card")
    .getByRole("button", { name: "发布派单" })
    .click();
  await page
    .locator(".mc-dialog")
    .getByRole("button", { name: "发布派单" })
    .click();

  await expect(page.locator(".mc-detail-title .mc-status")).toHaveText(
    "报名选人",
  );
});

test("记录台结算批准后状态回流到列表", async ({ page }) => {
  await page.goto("/merchant-console/settlements");

  await page
    .locator(".mc-order-link", { hasText: "S-20260908-01" })
    .click();
  await page.getByRole("button", { name: "复核并批准" }).click();
  await page
    .locator(".mc-dialog")
    .getByRole("button", { name: "批准批次" })
    .click();
  await expect(page.locator(".mc-detail-title .mc-status")).toHaveText(
    "已批准",
  );

  await page.getByRole("link", { name: /返回结算批次/ }).click();
  await expect(page.locator("tbody tr").first().locator(".mc-status")).toHaveText(
    "已批准",
  );
});

test("AI 需求助手解析后带入新建草稿", async ({ page }) => {
  await page.goto("/merchant-console/ai");

  await page.getByRole("button", { name: "解析为结构化建议" }).click();
  await expect(
    page.getByRole("button", { name: "带入新建订单" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "带入新建订单" }).click();

  await expect(page).toHaveURL(/\/merchant-console\/dispatch\/new$/);
  await page.getByRole("button", { name: "保存为草稿" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/dispatch\/29$/);
  await expect(page.locator(".mc-detail-title h1")).toHaveText(
    "GD-0908-029",
  );
});

test("监控台概览实时场次指标与实时页一致", async ({ page }) => {
  await page.goto("/merchant-console/overview");

  await expect(page.locator(".mc-metric-tile")).toHaveCount(4);
  await expect(page.locator(".mc-metric-tile b").nth(1)).toHaveText("2");
  await expect(page.locator(".mc-metric-tile b").nth(2)).toHaveText("3");
});

test("财务查看审计时提示只读涉自身", async ({ page }) => {
  await page.goto("/merchant-console/audit?role=FINANCE");

  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
  await expect(page.locator(".mc-notice")).toContainText("只读 · 涉自身");
});

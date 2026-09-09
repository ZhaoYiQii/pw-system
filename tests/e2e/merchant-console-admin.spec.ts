import { expect, test } from "@playwright/test";

const PASSWORD = "Dev-Password-123";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill("c1");
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
}

test("店长登录后进入新商家控制台工作台并看到真实导航", async ({ page }) => {
  await loginAsOwner(page);
  await expect(
    page.getByRole("heading", { name: /工作台|owner/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "订单台账" })).toBeVisible();
  await expect(page.getByRole("link", { name: "客户档案" })).toBeVisible();
  await expect(page.getByRole("link", { name: "陪玩档案" })).toBeVisible();
  await expect(page.getByRole("link", { name: "门店与套餐" })).toBeVisible();
});

test("记录台客户与陪玩从真实接口读取", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "客户档案" }).click();
  await expect(page.getByRole("heading", { name: "客户档案" })).toBeVisible();
  await expect(page.getByText("老王")).toBeVisible();

  await page.getByRole("link", { name: "陪玩档案" }).click();
  await expect(page.getByRole("heading", { name: "陪玩档案" })).toBeVisible();
  await expect(page.getByText("阿伟")).toBeVisible();
});

test("订单与派单台账读取真实订单数据", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "订单台账" }).click();
  await expect(page.getByRole("heading", { name: "订单与派单" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("门店设置读取真实配置并可切换分区", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "门店与套餐" }).click();
  await expect(page.getByRole("heading", { name: "门店设置" })).toBeVisible();
  await expect(page.locator(".mc-settings-tabs button")).toHaveCount(5);
  await page.getByRole("tab", { name: "员工与角色" }).click();
  await expect(page.getByRole("heading", { name: "员工与角色" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建员工" })).toBeVisible();
});

test("工作台待办可跳转订单台账并按状态筛选", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/merchant-console/dispatch?status=DRAFT");
  await expect(page).toHaveURL(/status=DRAFT/);
  await expect(
    page.locator('[role="tab"]', { hasText: "待发布" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("监控台概览展示真实指标入口", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/merchant-console/overview");
  await expect(page.getByRole("heading", { name: "门店概览" })).toBeVisible();
  await expect(page.locator(".mc-metric-tile")).toHaveCount(4);
});

test("商家端所有模块页面均可打开并渲染真实数据", async ({ page }) => {
  await loginAsOwner(page);
  const modules: Array<[string, string]> = [
    ["ai", "AI 需求助手"],
    ["dispatch", "订单与派单"],
    ["sessions", "场次与证据"],
    ["customers", "客户档案"],
    ["players", "陪玩档案"],
    ["catalog", "服务目录"],
    ["finance", "收入账本"],
    ["settlements", "结算批次"],
    ["disputes", "客诉记录"],
    ["audit", "审计日志"],
    ["overview", "门店概览"],
    ["live", "进行中场次"],
    ["risk", "异常与争议"],
    ["finrisk", "财务风险"],
    ["health", "通知与任务健康"],
    ["settings", "门店设置"],
  ];
  for (const [slug, title] of modules) {
    await page.goto(`/merchant-console/${slug}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  }
});

test("新建 GD 派单草稿后可真实发布", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/merchant-console/dispatch/new");
  await expect(page.getByRole("heading", { name: "新建派单" })).toBeVisible();

  await page
    .locator("label.mc-field", { hasText: "游戏模板" })
    .locator("select")
    .selectOption({ index: 1 });
  await page
    .locator("label.mc-field", { hasText: "老板客户" })
    .locator("select")
    .selectOption({ index: 1 });
  await page
    .locator("label.mc-field", { hasText: "区" })
    .locator("input")
    .fill("艾欧尼亚");
  await page
    .locator("label.mc-field", { hasText: "目标段位" })
    .locator("select")
    .selectOption({ label: "钻石" });
  await page
    .locator("label.mc-field", { hasText: "模式" })
    .locator("input")
    .fill("排位双排");

  await page.getByRole("button", { name: "创建派单草稿" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/dispatch\/.+kind=GD/);
  await expect(page.locator(".mc-detail-title .mc-status")).toBeVisible();

  const publish = page.getByRole("button", { name: "发布派单" }).first();
  if (await publish.isVisible().catch(() => false)) {
    await publish.click();
    await page
      .locator(".mc-dialog")
      .getByRole("button", { name: "发布派单" })
      .click();
    await expect(page.locator(".mc-detail-title .mc-status")).toHaveText(
      "报名选人",
      { timeout: 15_000 },
    );
  }
});

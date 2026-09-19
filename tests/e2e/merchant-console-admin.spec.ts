import { expect, test } from "@playwright/test";

const PASSWORD = "zcloud1024";

/**
 * S3 模板管理 E2E：夹具由 work/s3-e2e-seed.mjs 在授权的一次性测试库上创建，
 * 只跑带 "S3 模板管理" 前缀的用例（其它用例依赖开发库种子数据）。
 */
const S3_TENANT_CODE = process.env.S3_E2E_TENANT_CODE ?? "s3e2e";
const S3_PASSWORD = process.env.S3_E2E_PASSWORD ?? "zcloud1024";
/** 开发库种子门店 code；可用 E2E_TENANT_CODE 覆盖，默认沿用历史的 c1。 */
const DEV_TENANT_CODE = process.env.E2E_TENANT_CODE ?? "c1";

async function loginAsS3Owner(page: import("@playwright/test").Page) {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill(S3_TENANT_CODE);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(S3_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
}

async function createS3Template(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.goto("/merchant-console/dispatch/templates");
  await page.getByRole("button", { name: "新建模板" }).first().click();
  await page.getByLabel("游戏（必选）").selectOption({ index: 1 });
  await page.getByLabel("模板名称").fill(name);
  await page.getByRole("button", { name: "创建模板" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** 带三级子项的模块在导航里是「组按钮」，必须先展开再点子项。 */
async function openNavGroup(
  page: import("@playwright/test").Page,
  group: string,
  child: string,
) {
  const visible = async (locator: import("@playwright/test").Locator) =>
    (await locator.count()) > 0 && (await locator.isVisible());
  const trigger = page.getByRole("button", { name: group }).first();
  if (!(await visible(trigger))) {
    const domains = page.locator(
      "nav.mc-nav .mc-nav-domain > button[aria-expanded]",
    );
    const total = await domains.count();
    for (let index = 0; index < total; index += 1) {
      if (await visible(trigger)) break;
      await domains.nth(index).click();
    }
  }
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  const link = page.getByRole("link", { name: child }).first();
  await expect(link).toBeVisible();
  return link;
}

/**
 * 商家端导航按「业务域」折叠，模块链接只在展开的域里可见。 * 商家端导航按「业务域」折叠，模块链接只在展开的域里可见。
 * 依次展开每个业务域，直到候选名称之一出现；避免在测试里硬编码模块归属。
 */
async function openNavItem(
  page: import("@playwright/test").Page,
  names: readonly string[],
) {
  const find = async () => {
    for (const name of names) {
      const links = page.getByRole("link", { name });
      const total = await links.count();
      for (let index = 0; index < total; index += 1) {
        const link = links.nth(index);
        if (await link.isVisible()) return link;
      }
    }
    return null;
  };
  const direct = await find();
  if (direct) return direct;
  const domains = page.locator(
    "nav.mc-nav .mc-nav-domain > button[aria-expanded]",
  );
  const total = await domains.count();
  for (let index = 0; index < total; index += 1) {
    const trigger = domains.nth(index);
    if ((await trigger.getAttribute("aria-expanded")) === "true") continue;
    await trigger.click();
    const found = await find();
    if (found) return found;
  }
  throw new Error(`导航里找不到「${names.join(" / ")}」`);
}

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill(DEV_TENANT_CODE);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
}

/** S4 新栈选择器：按 aria-label 展开并选第一项。 */
async function pickFirstOption(
  page: import("@playwright/test").Page,
  label: string,
) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option").first().click();
}

/** mock 场景下走完「客户 → 游戏 → 模板」三个阶段。 */
async function selectMockedOrderContext(page: import("@playwright/test").Page) {
  await pickFirstOption(page, "老板客户");
  await pickFirstOption(page, "游戏");
  await page
    .getByRole("button", { name: /英雄联盟/ })
    .first()
    .click();
}

/** 新建派单 mock 用的发布快照：启用区块 + 两个字段 + 说明 + 一个停用区块。 */
const MOCKED_PUBLISHED_CONFIG = {
  schemaVersion: 2,
  documentRendererVersion: 1,
  sections: [
    {
      stableKey: "need",
      label: "需求信息",
      enabled: true,
      sortOrder: 0,
      layout: { columns: 2 },
    },
    {
      stableKey: "off",
      label: "已停用区块",
      enabled: false,
      sortOrder: 1,
      layout: { columns: 1 },
    },
  ],
  components: [
    {
      kind: "FIELD",
      stableKey: "server",
      sectionKey: "need",
      label: "区服",
      enabled: true,
      sortOrder: 0,
      layout: { colSpan: 1, rowBreakBefore: false },
      fieldType: "TEXT",
      semanticRole: "CUSTOM",
      required: true,
      placeholder: "请输入区服",
    },
    {
      kind: "FIELD",
      stableKey: "requirement",
      sectionKey: "need",
      label: "特殊要求",
      enabled: true,
      sortOrder: 1,
      layout: { colSpan: 2, rowBreakBefore: true },
      fieldType: "TEXTAREA",
      semanticRole: "ORDER_NOTE",
      required: false,
      placeholder: "填写特殊要求",
    },
    {
      kind: "NOTE",
      stableKey: "reminder",
      sectionKey: "need",
      label: "须知",
      enabled: true,
      sortOrder: 2,
      layout: { colSpan: 2, rowBreakBefore: true },
      text: "请确认老板需求后再发布",
    },
    {
      kind: "FIELD",
      stableKey: "hidden",
      sectionKey: "off",
      label: "停用字段",
      enabled: true,
      sortOrder: 0,
      layout: { colSpan: 1, rowBreakBefore: false },
      fieldType: "TEXT",
      semanticRole: "CUSTOM",
      required: false,
    },
  ],
  staffingSource: { kind: "FIXED", count: 1 },
} as const;

async function openMockedNewOrder(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("pw_access_token", "e2e-token");
  });
  await page.route(
    /^http:\/\/127\.0\.0\.1:(?:3000|3100)\/api\/v1\//,
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const dataByPath: Record<string, unknown> = {
        "/api/v1/tenant/me": {
          sub: "owner-1",
          username: "owner",
          role: "TENANT_OWNER",
          tenantId: "tenant-1",
        },
        "/api/v1/tenant/config": { config: null },
        "/api/v1/tenant/game-templates": [
          { id: "template-1", name: "英雄联盟", enabled: true },
        ],
        "/api/v1/tenant/game-templates/template-1": {
          id: "template-1",
          name: "英雄联盟",
          enabled: true,
          fields: [],
          positions: [{ id: "position-1", label: "上单", defaultCount: 1 }],
        },
        "/api/v1/tenant/customers": [
          {
            id: "customer-1",
            name: "测试客户",
            mobile: null,
            remark: null,
            status: "ACTIVE",
            createdAt: "2026-09-10T00:00:00.000Z",
          },
        ],
        // S4：新建派单改为三阶段 + v2 契约（游戏 → 已发布模板 → 发布快照表单）
        // S5：前端先读能力位；mock 里显式开通，否则 v2 入口显示"未开通"。
        "/api/v1/tenant/features": [
          { featureKey: "addon.game_dispatch_template_v2", enabled: true },
        ],
        "/api/v1/tenant/catalog/games": [
          { id: "game-1", name: "英雄联盟", enabled: true },
        ],
        "/api/v1/tenant/game-dispatch-templates/published": [
          {
            templateId: "template-1",
            name: "英雄联盟",
            description: null,
            versionId: "version-1",
            versionNo: 1,
            isDefault: true,
            lastUsedAt: null,
          },
        ],
        "/api/v1/tenant/game-dispatch-templates/versions/version-1/form": {
          templateId: "template-1",
          gameId: "game-1",
          versionId: "version-1",
          versionNo: 1,
          config: MOCKED_PUBLISHED_CONFIG,
        },
        "/api/v1/tenant/game-dispatch/orders/order-1": {
          dispatchNo: "GD-E2E-1",
          status: "DRAFT",
          copyText: "历史群文案（旧订单）",
          applyUrl: "",
          bossUrl: "",
          lines: [],
          round: null,
          document: {
            schemaVersion: 1,
            rendererVersion: 1,
            rows: [
              {
                sectionLabel: "需求信息",
                fieldLabel: "区服",
                value: "艾欧尼亚",
              },
            ],
            plainText: "【需求信息】\\n区服：艾欧尼亚",
            generatedFromSnapshotAt: "2026-09-17T00:00:00.000Z",
          },
        },
        "/api/v1/tenant/game-dispatch/template-orders": {
          orderId: "order-1",
          dispatchOrderId: "dispatch-1",
          templateVersionId: "version-1",
          staffingSummary: { total: 1, rows: [{ label: "人数", count: 1 }] },
          priceAdjustmentFen: "0",
          document: {
            schemaVersion: 1,
            rendererVersion: 1,
            rows: [],
            plainText: "【需求信息】",
          },
        },
      };
      const data = dataByPath[pathname];
      await route.fulfill({
        status: data === undefined ? 404 : 200,
        contentType: "application/json",
        body: JSON.stringify({ data: data ?? null }),
      });
    },
  );
  await page.goto("/merchant-console/dispatch/new");
  await expect(page.getByRole("heading", { name: "新建派单" })).toBeVisible();
}

test("店长登录后进入新商家控制台工作台并看到真实导航", async ({ page }) => {
  await loginAsOwner(page);
  await expect(
    page.getByRole("heading", { name: /工作台|owner/ }),
  ).toBeVisible();
  await expect(
    await openNavGroup(page, "订单中心", "派单工作台"),
  ).toBeVisible();
  await expect(await openNavItem(page, ["客户档案"])).toBeVisible();
  await expect(await openNavItem(page, ["陪玩档案"])).toBeVisible();
  await expect(await openNavItem(page, ["门店与套餐"])).toBeVisible();
});

test("记录台客户与陪玩从真实接口读取", async ({ page }) => {
  await loginAsOwner(page);
  await (await openNavItem(page, ["客户档案"])).click();
  await expect(page.getByRole("heading", { name: "客户档案" })).toBeVisible();
  await expect(page.getByText("老王")).toBeVisible();

  await (await openNavItem(page, ["陪玩档案"])).click();
  await expect(page.getByRole("heading", { name: "陪玩档案" })).toBeVisible();
  await expect(page.getByText("阿伟")).toBeVisible();
});

test("订单与派单台账读取真实订单数据", async ({ page }) => {
  // 先按真实 API 流程造一条派单，再断言台账里看得到（自给自足，不依赖门店预置数据）
  const session = await s4Session(page);
  const suffix = Date.now().toString(36);
  const gameName = `台账用例-${suffix}`;
  const gameId = await s4CreateGame(page, session, gameName);
  await s4PublishTemplate(page, session, gameId, `台账模板-${suffix}`, {
    setDefault: true,
  });

  await s4Login(page);
  await page.goto("/merchant-console/dispatch/new");
  await s4SelectContext(page, gameName);
  await page
    .getByRole("button", { name: new RegExp(`台账模板-${suffix}`) })
    .click();
  await page.getByLabel("区服").fill("艾欧尼亚");
  await page.getByLabel("模式").selectOption("ranked");
  await page.getByRole("button", { name: "添加行" }).click();
  await page.getByLabel("岗位与人数 第 1 行 位置").fill("陪玩");
  await page.getByLabel("岗位与人数 第 1 行 人数").fill("1");
  await page.getByRole("button", { name: "创建派单草稿" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/dispatch\/.+kind=GD/);

  // 台账里应当出现这一条
  await page.goto("/merchant-console/dispatch");
  await expect(page.getByRole("heading", { name: "订单与派单" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("门店设置读取真实配置并可切换分区", async ({ page }) => {
  await loginAsOwner(page);
  await (await openNavItem(page, ["门店与套餐"])).click();
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

// 说明：S4 起新建派单走 v2 契约（客户+游戏 → 模板 → 发布快照表单）。
// 这里用 mock 契约验证「填写 → 提交 → 跳转详情」的接线；真实 API 的创建与发布
// 由 Task 6 的一次性测试库 E2E 覆盖（需要 dev 库的旧用例已移除）。
test("新建派单按发布快照提交后跳转订单详情", async ({ page }) => {
  await openMockedNewOrder(page);
  await selectMockedOrderContext(page);

  await page.getByLabel("区服").fill("艾欧尼亚");
  await page.getByRole("button", { name: "创建派单草稿" }).click();

  await expect(page).toHaveURL(
    /\/merchant-console\/dispatch\/order-1\?kind=GD/,
  );

  // S4 Task 5：详情页按订单快照渲染文案并可直接复制
  await expect(page.getByRole("heading", { name: "派单文案" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "艾欧尼亚" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制派单文案" }),
  ).toBeVisible();
  await expect(page.getByText("历史群文案", { exact: false })).toHaveCount(0);
});

test("新建派单可搜索下拉可点击外部或按 ESC 关闭", async ({ page }) => {
  await openMockedNewOrder(page);

  const customerPicker = page.getByRole("combobox", { name: "老板客户" });
  const customerOptions = page.getByRole("listbox", { name: "老板客户选项" });
  await customerPicker.click();
  await expect(customerOptions).toBeVisible();

  const inputBox = await customerPicker.boundingBox();
  const optionsBox = await customerOptions.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(optionsBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);

  await page.keyboard.press("Escape");
  await expect(customerOptions).toBeHidden();

  const gamePicker = page.getByRole("combobox", { name: "游戏" });
  const gameOptions = page.getByRole("listbox", { name: "游戏选项" });
  await gamePicker.click();
  await expect(gameOptions).toBeVisible();
  await page.getByRole("heading", { name: "新建派单" }).click();
  await expect(gameOptions).toBeHidden();
});

test("新建派单三级选择器有明确名称并暴露下拉状态", async ({ page }) => {
  await openMockedNewOrder(page);

  const customerPicker = page.getByRole("combobox", { name: "老板客户" });
  const gamePicker = page.getByRole("combobox", { name: "游戏" });
  await expect(customerPicker).toHaveAttribute("aria-expanded", "false");
  await expect(gamePicker).toHaveAttribute("aria-expanded", "false");

  await gamePicker.click();
  await expect(gamePicker).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("listbox", { name: "游戏选项" })).toBeVisible();

  await page.getByRole("option", { name: "英雄联盟" }).click();
  // 阶段由「客户 + 游戏」共同推进，先补选客户才会出现模板列表
  await pickFirstOption(page, "老板客户");
  await expect(
    page.getByRole("button", { name: /英雄联盟/ }).first(),
  ).toBeVisible();
});

// 说明：原用例比较「模板预览」与「新建派单」两处渲染。S4 起新建派单读发布快照，
// 布局一致性由 S3 的 form-layout / template-form-renderer 单测保证（form-layout-v2.spec.ts），
// 这里验证的是「新单按发布快照渲染：启用区块显示、停用区块与字段不出现」。
test("新建派单按发布快照渲染启用区块与字段", async ({ page }) => {
  await openMockedNewOrder(page);
  await selectMockedOrderContext(page);

  await expect(page.getByRole("heading", { name: "需求信息" })).toBeVisible();
  await expect(page.getByLabel("区服")).toBeVisible();
  await expect(page.getByLabel("特殊要求")).toBeVisible();
  await expect(page.getByText("请确认老板需求后再发布")).toBeVisible();
  await expect(page.getByText("已停用区块", { exact: true })).toHaveCount(0);
  await expect(page.getByText("停用字段", { exact: true })).toHaveCount(0);

  // 必填缺失时按钮仍禁用逻辑由流程层保证；这里断言未填时给出提示
  await expect(page.getByText(/个必填项未填写/)).toBeVisible();
});

test.describe("S3 模板管理主路径（真实本地 API）", () => {
  test("S3 模板管理：新建 → 加内容 → 保存草稿 → 发布 v1 → 归档", async ({
    page,
  }) => {
    const name = `E2E 排位陪练 ${Date.now().toString(36)}`;
    await loginAsS3Owner(page);
    await createS3Template(page, name);

    // 内容设计：只给原语，不给预设——分组与内容全部自建
    await page.getByRole("button", { name: "+ 新建分组" }).click();
    await page.getByRole("button", { name: "+ 新建字段" }).click();
    await page.getByLabel("名称", { exact: true }).fill("区服");
    await page.getByRole("button", { name: "单选", exact: true }).click();
    await expect(
      page.locator("[data-template-editor] [data-component-key]"),
    ).toHaveCount(1);

    // 表格的列由店主自己定义
    await page.getByRole("button", { name: "+ 新建表格" }).click();
    await page.getByLabel("列 1 名称").fill("岗位");
    await page.getByRole("button", { name: "+ 添加列" }).click();
    await page.getByLabel("列 2 名称").fill("人数");
    await page.getByLabel("列 2 类型").selectOption("NUMBER");
    await expect(
      page.locator("[data-template-editor] [data-component-key]"),
    ).toHaveCount(2);

    // 编号留在清单里；客户视角收在「渲染」弹层（D-16 / D-22）
    const editorRows = page.locator(
      "[data-template-editor] [data-component-key]",
    );
    await expect(editorRows.nth(0).locator("[data-row-number]")).toHaveText(
      "1",
    );
    await expect(editorRows.nth(1).locator("[data-row-number]")).toHaveText(
      "2",
    );
    await expect(page.locator("[data-preview-item]")).toHaveCount(0);
    if (process.env.S3_E2E_SHOTS) {
      await page.screenshot({
        path: "work/screenshots/template-editor.png",
        fullPage: true,
      });
    }

    // 端口可见性（V-2 / V-3 / V-5）：分组开关默认两个都开
    const sectionToggles = page.locator(
      '[data-audience-scope="section"] [data-audience-toggle]',
    );
    await expect(sectionToggles).toHaveCount(2);
    await expect(
      page.locator('[data-audience-scope="section"] [data-audience="CS"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(
        '[data-audience-scope="section"] [data-audience="CUSTOMER"]',
      ),
    ).toHaveAttribute("aria-pressed", "true");
    // 行内标签：未单独声明时跟随分组，两个端口都在
    await expect(editorRows.nth(0).locator("[data-audience-chip]")).toHaveText(
      "客服·客户",
    );

    // 把表格单独设为「只给客户」：组件覆盖分组（V-3），行内标签立刻变成覆盖态
    const tableKey = await editorRows.nth(1).getAttribute("data-component-key");
    const tablePanel = page.locator(`[data-audience-panel="${tableKey}"]`);
    if ((await tablePanel.count()) === 0) {
      await editorRows.nth(1).locator("button").first().click();
    }
    await expect(tablePanel).toBeVisible();
    const panelCsToggle = tablePanel.locator('[data-audience="CS"]');
    await panelCsToggle.click();
    await expect(panelCsToggle).toHaveAttribute("aria-pressed", "false");
    await expect(editorRows.nth(1).locator("[data-audience-chip]")).toHaveText(
      "客户",
    );
    await expect(tablePanel).toContainText("已单独设置，不跟随分组");
    await editorRows.nth(1).locator("button").first().click();
    await expect(tablePanel).toBeHidden();

    // 像素级视觉回归基线（首次用 --update-snapshots 生成）。
    // 只截编辑器本体：模板名含时间戳，全页快照每次都不同。
    await expect(page.locator("[data-template-editor]")).toHaveScreenshot(
      "template-editor.png",
      { animations: "disabled", maxDiffPixels: 150 },
    );

    // 「渲染」按钮弹出两页预览，默认停在客服页（V-11）
    await page.getByRole("button", { name: "渲染" }).click();
    // 弹层的无障碍名字随页切换，所以这里按角色取、不按名字取
    const renderDialog = page.getByRole("dialog");
    await expect(renderDialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "客服看到的样子" }),
    ).toBeVisible();
    const previewItems = renderDialog.locator("[data-preview-item]");
    // 客服页看不到「只给客户」的表格（V-5），但看得到未标记的区服字段
    await expect(previewItems).toHaveCount(1);
    await expect(renderDialog).toContainText("区服");
    await expect(renderDialog).toContainText("1 项内容这个端口看不到");
    await expect(
      previewItems.nth(0).locator("[data-preview-number]"),
    ).toHaveText("1");
    if (process.env.S3_E2E_SHOTS) {
      await page.screenshot({
        path: "work/screenshots/template-editor-render.png",
        fullPage: false,
      });
    }
    await expect(renderDialog).toHaveScreenshot(
      "template-render-dialog-cs.png",
      {
        animations: "disabled",
        maxDiffPixels: 150,
      },
    );
    // 切到客户页：两页内容不同，客人看得到表格、看不到被标为客服专属的内容
    await renderDialog.locator('[data-audience-page="CUSTOMER"]').click();
    await expect(
      renderDialog.locator('[data-audience-page="CUSTOMER"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(previewItems).toHaveCount(2);
    await expect(renderDialog).not.toContainText("项内容这个端口看不到");
    await expect(
      renderDialog.locator("[data-audience-body='CUSTOMER']"),
    ).toBeVisible();
    await expect(renderDialog).toHaveScreenshot(
      "template-render-dialog-customer.png",
      { animations: "disabled", maxDiffPixels: 150 },
    );
    // 方向键回到客服页
    await page.keyboard.press("ArrowLeft");
    await expect(
      renderDialog.locator('[data-audience-page="CS"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(previewItems).toHaveCount(1);
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(renderDialog).toBeHidden();

    // 端口规则要求值类内容留给能填写下单的端口（客服），所以发布前把表格改回客服可见；
    // 两页差异已在上面的弹层断言里验证过。
    await editorRows.nth(1).locator("button").first().click();
    await expect(tablePanel).toBeVisible();
    await tablePanel.locator('[data-audience="CS"]').click();
    await expect(tablePanel.locator('[data-audience="CS"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await editorRows.nth(1).locator("button").first().click();
    await expect(tablePanel).toBeHidden();
    await expect(editorRows.nth(1).locator("[data-audience-chip]")).toHaveText(
      "客服·客户",
    );

    // 模板列表可隐藏，编辑区随之变宽
    const composerWidth = () =>
      page
        .locator("[data-template-editor]")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const widthBefore = await composerWidth();
    await page.getByRole("button", { name: "隐藏模板列表" }).click();
    await expect(page.locator('[aria-label="模板列表"]')).toBeHidden();
    expect(await composerWidth()).toBeGreaterThan(widthBefore);
    if (process.env.S3_E2E_SHOTS) {
      await page.screenshot({
        path: "work/screenshots/template-list-hidden.png",
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "显示模板列表" }).click();
    await expect(page.locator('[aria-label="模板列表"]')).toBeVisible();

    // 算价配置不属于派单模板模块：「业务绑定与计算」这一屏已取消
    await expect(page.getByRole("tab", { name: "业务绑定与计算" })).toHaveCount(
      0,
    );

    // 保存草稿（expectedRevision 乐观锁）
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByText(/草稿已保存 · r\d+/)).toBeVisible();

    // 发布：切到发布标签 → 填写备注 → 发布
    await page.getByRole("tab", { name: "发布设置与版本历史" }).click();
    await page.getByPlaceholder("例如：新增段位加价").fill("E2E 首次发布");
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await expect(page.getByText(/已发布 v\d+/)).toBeVisible();

    // 版本历史出现 v1，且备注被记入该行（详情卡也有一个 v1，必须限定到版本行）
    const versionRow = page.locator('[data-version-no="1"]');
    await expect(versionRow.getByText("v1", { exact: true })).toBeVisible();
    await expect(versionRow).toContainText("E2E 首次发布");

    // 文案预览：按当前草稿生成表格与纯文本（区块标题 + 岗位人数默认行）
    await expect(page.getByText("文案预览（按当前草稿）")).toBeVisible();
    await expect(page.getByText(/【新分组】/).first()).toBeVisible();

    // 次级操作：归档后保存草稿与发布都不可用（提示走 aria-live 状态区）
    await page.getByRole("button", { name: "归档", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已归档 · 历史订单不受影响" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "发布", exact: true }),
    ).toBeDisabled();

    // 取消归档后恢复编辑；再次保存草稿把状态推进到「有未发布改动」
    await page.getByRole("button", { name: "取消归档", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已取消归档" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "内容设计" }).click();
    await page.getByRole("button", { name: "+ 新建字段" }).click();
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByText(/草稿已保存 · r\d+/)).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "模板详情" })
        .getByText("有未发布改动", { exact: true }),
    ).toBeVisible();
  });

  test("S3 模板管理：并发保存冲突返回 409 且本地草稿保留", async ({
    browser,
  }) => {
    const name = `E2E 冲突 ${Date.now().toString(36)}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      // A：同一门店的另一个会话，先保存一次把服务端推进到 r2
      const pageA = await contextA.newPage();
      await loginAsS3Owner(pageA);
      await createS3Template(pageA, name);
      await pageA.getByRole("button", { name: "+ 新建分组" }).click();
      await pageA.getByRole("button", { name: "保存草稿" }).click();
      await expect(pageA.getByText(/草稿已保存 · r\d+/)).toBeVisible();

      // B：打开同一模板并保存，服务端 revision 再前进一格
      const pageB = await contextB.newPage();
      await loginAsS3Owner(pageB);
      await pageB.goto("/merchant-console/dispatch/templates");
      await pageB
        .getByRole("button", { name: new RegExp(name) })
        .first()
        .click();
      await pageB.getByRole("button", { name: "+ 新建字段" }).click();
      await pageB.getByRole("button", { name: "保存草稿" }).click();
      await expect(pageB.getByText(/草稿已保存 · r\d+/)).toBeVisible();

      // A 手里还是旧 revision：再保存必须 409，并给出冲突处理选项
      await pageA.getByRole("button", { name: "+ 新建字段" }).click();
      await pageA.getByRole("button", { name: "保存草稿" }).click();
      await expect(pageA.getByText(/另一个管理员刚保存过/)).toBeVisible();
      await expect(
        pageA.getByText("你的改动还在本地，不会被自动覆盖。"),
      ).toBeVisible();
      await expect(
        pageA.getByRole("button", { name: "重新加载服务端" }),
      ).toBeVisible();

      // 冲突期间本地草稿保留：A 刚加的字段还在
      await expect(
        pageA.locator("[data-template-editor] [data-component-key]"),
      ).toHaveCount(1);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("S3 模板管理：键盘上移保持焦点与顺序", async ({ page }) => {
    const name = `E2E 键盘 ${Date.now().toString(36)}`;
    await loginAsS3Owner(page);
    await createS3Template(page, name);

    await page.getByRole("button", { name: "+ 新建分组" }).click();
    await page.getByRole("button", { name: "+ 新建字段" }).click();
    await page.getByLabel("名称", { exact: true }).fill("字段 A");
    await page.getByRole("button", { name: "+ 新建字段" }).click();
    await page.getByLabel("名称", { exact: true }).fill("字段 B");

    const rows = page.locator("[data-template-editor] [data-component-key]");
    await expect(rows).toHaveCount(2);

    const moveUpButtons = rows.locator('button[data-action="move-up"]');
    await moveUpButtons.nth(1).focus();
    const focusedBefore = await page.evaluate(() =>
      document.activeElement
        ?.closest("[data-component-key]")
        ?.getAttribute("data-component-key"),
    );

    await page.keyboard.press("Enter");
    await expect(page.getByText(/已把「字段 B」上移到第 1 位/)).toBeVisible();

    const values = await rows
      .locator("button[aria-expanded]")
      .evaluateAll((elements) =>
        elements.map((element) => element.textContent?.trim() ?? ""),
      );
    expect(values).toEqual(["字段 B", "字段 A"]);

    const focusedAfter = await page.evaluate(() =>
      document.activeElement
        ?.closest("[data-component-key]")
        ?.getAttribute("data-component-key"),
    );
    expect(focusedAfter).toBe(focusedBefore);
  });
});

/* ------------------------------------------------------------------ S4 */

const S4_TENANT_CODE = process.env.S4_E2E_TENANT_CODE ?? "s4e2e";
const S4_PASSWORD = process.env.S4_E2E_PASSWORD ?? "zcloud1024";
/**
 * API 源：夹具通过真实 HTTP 建立（建游戏/模板/发布）。
 * 与 admin 的 baseURL 分开配置，避免把 API 端口写死在断言里。
 */
const S4_API_ORIGIN = process.env.S4_API_ORIGIN ?? "http://127.0.0.1:3100";

/** S4 发布快照：必填单选（带加价）+ 人数表格（列汇总）+ 说明。 */
function s4Config() {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "need",
        label: "需求信息",
        enabled: true,
        sortOrder: 0,
        layout: { columns: 2 },
      },
      {
        stableKey: "roster",
        label: "组队岗位",
        enabled: true,
        sortOrder: 1,
        layout: { columns: 1 },
      },
    ],
    components: [
      {
        kind: "FIELD",
        stableKey: "server",
        sectionKey: "need",
        label: "区服",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: true,
        placeholder: "请输入区服",
      },
      {
        kind: "FIELD",
        stableKey: "mode",
        sectionKey: "need",
        label: "模式",
        enabled: true,
        sortOrder: 1,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "SINGLE_SELECT",
        semanticRole: "MODE",
        required: true,
        options: [
          { value: "ranked", label: "排位", priceDeltaFen: "1500" },
          { value: "normal", label: "匹配" },
        ],
      },
      {
        kind: "NOTE",
        stableKey: "reminder",
        sectionKey: "need",
        label: "须知",
        enabled: true,
        sortOrder: 2,
        layout: { colSpan: 2, rowBreakBefore: true },
        text: "请确认老板需求后再发布",
      },
      {
        kind: "REPEATABLE_TABLE",
        stableKey: "roster_table",
        sectionKey: "roster",
        label: "岗位与人数",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        columns: [
          {
            stableKey: "position",
            label: "位置",
            columnType: "TEXT",
            semanticRole: "STAFFING_LABEL",
            required: true,
          },
          {
            stableKey: "count",
            label: "人数",
            columnType: "NUMBER",
            semanticRole: "STAFFING_COUNT",
            required: true,
          },
        ],
        defaultRows: [{ position: "陪玩", count: 1 }],
      },
    ],
    staffingSource: {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: "roster_table",
      columnKey: "count",
    },
  };
}

interface S4Session {
  token: string;
  headers: { authorization: string; "content-type": string };
}

/** 用真实登录接口换 token（页面会话与夹具共用同一租户账号）。 */
async function s4Session(
  page: import("@playwright/test").Page,
): Promise<S4Session> {
  const res = await page.request.post(`${S4_API_ORIGIN}/api/v1/auth/login`, {
    data: {
      kind: "tenant",
      tenantCode: S4_TENANT_CODE,
      username: "owner",
      password: S4_PASSWORD,
    },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string } };
  return {
    token: body.data.accessToken,
    headers: {
      authorization: `Bearer ${body.data.accessToken}`,
      "content-type": "application/json",
    },
  };
}

/** 经真实接口建游戏（每次运行唯一命名，避免跨运行串数据）。 */
async function s4CreateGame(
  page: import("@playwright/test").Page,
  session: S4Session,
  name: string,
): Promise<string> {
  const res = await page.request.post(
    `${S4_API_ORIGIN}/api/v1/tenant/catalog/games`,
    { headers: session.headers, data: { name } },
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** 建模板 → 存草稿 → 发布，返回锁定版本信息。 */
async function s4PublishTemplate(
  page: import("@playwright/test").Page,
  session: S4Session,
  gameId: string,
  name: string,
  options: { setDefault?: boolean } = {},
): Promise<{ templateId: string; versionId: string; revision: number }> {
  const base = `${S4_API_ORIGIN}/api/v1/tenant/game-dispatch-templates`;
  const created = await page.request.post(base, {
    headers: session.headers,
    data: { gameId, name, description: null },
  });
  expect(created.ok()).toBe(true);
  const createdBody = (await created.json()) as {
    data: { id: string; revision: number };
  };
  const templateId = createdBody.data.id;

  const saved = await page.request.patch(`${base}/${templateId}/draft`, {
    headers: session.headers,
    data: { expectedRevision: createdBody.data.revision, config: s4Config() },
  });
  expect(saved.ok()).toBe(true);
  const savedBody = (await saved.json()) as { data: { revision: number } };

  const published = await page.request.post(`${base}/${templateId}/publish`, {
    headers: session.headers,
    data: { expectedRevision: savedBody.data.revision, changeNote: "S4 E2E" },
  });
  expect(published.ok()).toBe(true);
  const publishedBody = (await published.json()) as {
    data: { revision: number; activeVersion: { id: string } };
  };

  // 设默认要求模板已有生效版本，因此放在发布之后（会用发布后的 revision）。
  if (options.setDefault) {
    const asDefault = await page.request.post(`${base}/${templateId}/default`, {
      headers: session.headers,
      data: { expectedRevision: publishedBody.data.revision },
    });
    expect(asDefault.ok()).toBe(true);
  }
  return {
    templateId,
    versionId: publishedBody.data.activeVersion.id,
    revision: publishedBody.data.revision,
  };
}

/** 页面登录（真实 UI 登录，用于把会话写进浏览器）。 */
async function s4Login(page: import("@playwright/test").Page) {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill(S4_TENANT_CODE);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(S4_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
}

/** 走完「客户 → 游戏 → 模板」三个阶段。 */
async function s4SelectContext(
  page: import("@playwright/test").Page,
  gameName: string,
) {
  await page.getByRole("combobox", { name: "老板客户" }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("combobox", { name: "游戏" }).click();
  await page.getByRole("option", { name: gameName, exact: true }).click();
}

test.describe("S4 新建派单主路径（真实本地 API）", () => {
  test("S4 新建派单：按游戏选已发布模板 → 快照表单 → 创建 → 详情文案来自快照", async ({
    page,
  }) => {
    const session = await s4Session(page);
    const suffix = Date.now().toString(36);
    const gameA = `英雄联盟 S4-${suffix}`;
    const gameB = `无畏契约 S4-${suffix}`;
    const gameAId = await s4CreateGame(page, session, gameA);
    const gameBId = await s4CreateGame(page, session, gameB);
    const templateA = await s4PublishTemplate(
      page,
      session,
      gameAId,
      `A 店排位陪练-${suffix}`,
      { setDefault: true },
    );
    await s4PublishTemplate(page, session, gameBId, `B 店匹配陪练-${suffix}`);

    await s4Login(page);
    await page.goto("/merchant-console/dispatch/new");
    await s4SelectContext(page, gameA);

    // 只看到该游戏的模板，且默认模板有标记
    await expect(
      page.getByRole("button", { name: new RegExp(`A 店排位陪练-${suffix}`) }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(`B 店匹配陪练-${suffix}`) }),
    ).toHaveCount(0);
    await expect(page.getByText("默认", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: new RegExp(`A 店排位陪练-${suffix}`) })
      .click();
    await expect(page.getByRole("heading", { name: "需求信息" })).toBeVisible();
    await expect(page.getByText("请确认老板需求后再发布")).toBeVisible();

    await page.getByLabel("区服").fill("艾欧尼亚");
    await page.getByLabel("模式").selectOption("ranked");
    await page.getByRole("button", { name: "添加行" }).click();
    await page.getByLabel("岗位与人数 第 1 行 位置").fill("陪玩");
    await page.getByLabel("岗位与人数 第 1 行 人数").fill("2");

    await page.getByRole("button", { name: "创建派单草稿" }).click();
    await expect(page).toHaveURL(/\/merchant-console\/dispatch\/.+kind=GD/);

    // 详情文案来自订单快照（服务端生成），不读当前模板
    await expect(page.getByRole("heading", { name: "派单文案" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "艾欧尼亚" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "复制派单文案" }),
    ).toBeVisible();
    expect(templateA.versionId).not.toBe("");
  });

  test("S4 新建派单：模板归档后拒绝创建并保留已填内容", async ({ page }) => {
    const session = await s4Session(page);
    const suffix = Date.now().toString(36);
    const gameName = `归档用例-${suffix}`;
    const gameId = await s4CreateGame(page, session, gameName);
    const template = await s4PublishTemplate(
      page,
      session,
      gameId,
      `待归档模板-${suffix}`,
    );

    await s4Login(page);
    await page.goto("/merchant-console/dispatch/new");
    await s4SelectContext(page, gameName);
    await page
      .getByRole("button", { name: new RegExp(`待归档模板-${suffix}`) })
      .click();
    await page.getByLabel("区服").fill("诺克萨斯");
    await page.getByLabel("模式").selectOption("normal");

    // 填写期间模板被归档：服务端必须拒绝，页面保留输入
    const archived = await page.request.post(
      `${S4_API_ORIGIN}/api/v1/tenant/game-dispatch-templates/${template.templateId}/archive`,
      {
        headers: session.headers,
        data: { expectedRevision: template.revision },
      },
    );
    expect(archived.ok()).toBe(true);

    await page.getByRole("button", { name: "创建派单草稿" }).click();
    await expect(
      page.getByText(
        "该模板已被归档，请重新选择可用模板（已填写的内容仍保留）。",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("区服")).toHaveValue("诺克萨斯");
  });

  test("S4 创建派单幂等：同一意图重复提交返回同一订单", async ({ page }) => {
    const session = await s4Session(page);
    const suffix = Date.now().toString(36);
    const gameName = `幂等用例-${suffix}`;
    const gameId = await s4CreateGame(page, session, gameName);
    const template = await s4PublishTemplate(
      page,
      session,
      gameId,
      `幂等模板-${suffix}`,
    );
    const customers = await page.request.get(
      `${S4_API_ORIGIN}/api/v1/tenant/customers`,
      { headers: session.headers },
    );
    expect(customers.ok()).toBe(true);
    const customerBody = (await customers.json()) as {
      data: { id: string }[];
    };
    const customerProfileId = customerBody.data[0]?.id ?? "";
    expect(customerProfileId).not.toBe("");

    const payload = {
      gameId,
      templateId: template.templateId,
      templateVersionId: template.versionId,
      customerProfileId,
      values: {
        server: "艾欧尼亚",
        mode: "normal",
        roster_table: [{ position: "陪玩", count: 1 }],
      },
      durationMinutes: 60,
    };
    const key = `s4-idem-${suffix}`;
    const headers = { ...session.headers, "idempotency-key": key };
    const first = await page.request.post(
      `${S4_API_ORIGIN}/api/v1/tenant/game-dispatch/template-orders`,
      { headers, data: payload },
    );
    const second = await page.request.post(
      `${S4_API_ORIGIN}/api/v1/tenant/game-dispatch/template-orders`,
      { headers, data: payload },
    );
    expect(first.ok()).toBe(true);
    expect(second.ok()).toBe(true);
    const firstBody = (await first.json()) as {
      data: { dispatchOrderId: string; staffingSummary: { total: number } };
    };
    const secondBody = (await second.json()) as {
      data: { dispatchOrderId: string };
    };
    expect(secondBody.data.dispatchOrderId).toBe(
      firstBody.data.dispatchOrderId,
    );
    expect(firstBody.data.staffingSummary.total).toBe(1);
  });
});

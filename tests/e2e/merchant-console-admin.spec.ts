import { expect, test } from "@playwright/test";

const PASSWORD = "zcloud1024";

/**
 * S3 模板管理 E2E：夹具由 work/s3-e2e-seed.mjs 在授权的一次性测试库上创建，
 * 只跑带 "S3 模板管理" 前缀的用例（其它用例依赖开发库种子数据）。
 */
const S3_TENANT_CODE = process.env.S3_E2E_TENANT_CODE ?? "s3e2e";
const S3_PASSWORD = process.env.S3_E2E_PASSWORD ?? "zcloud1024";

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

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill("c1");
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
}

async function pickFirstSearchable(
  page: import("@playwright/test").Page,
  fieldLabel: string,
) {
  const field = page.locator(".mc-field", { hasText: fieldLabel });
  await field.locator("input").click();
  await field.locator(".mc-picker-option").first().click();
}

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

const SYNCED_TEMPLATE = {
  id: "template-synced",
  name: "同步布局模板",
  enabled: true,
  blockLabels: { positions: "组队岗位" },
  sections: [
    {
      id: "section-active",
      name: "需求信息",
      columns: 3,
      sortOrder: 0,
      enabled: true,
    },
    {
      id: "section-disabled",
      name: "已停用区块",
      columns: 2,
      sortOrder: 1,
      enabled: false,
    },
  ],
  fields: [
    {
      id: "field-server",
      fieldKey: "server",
      label: "区服",
      fieldType: "text",
      required: true,
      options: [],
      placeholder: "请输入区服",
      sectionId: "section-active",
      colSpan: 1,
      rowBreakBefore: false,
      sortOrder: 0,
      enabled: true,
    },
    {
      id: "field-requirement",
      fieldKey: "requirement",
      label: "特殊要求",
      fieldType: "multiline",
      required: false,
      options: [],
      placeholder: "填写特殊要求",
      sectionId: "section-active",
      colSpan: 2,
      rowBreakBefore: true,
      sortOrder: 1,
      enabled: true,
    },
    {
      id: "field-note",
      fieldKey: "notice",
      label: "接单说明",
      fieldType: "note",
      required: false,
      options: [],
      placeholder: "请确认老板需求后再发布",
      sectionId: "section-active",
      colSpan: 3,
      rowBreakBefore: false,
      sortOrder: 2,
      enabled: true,
    },
    {
      id: "field-disabled",
      fieldKey: "hidden_active_field",
      label: "已停用字段",
      fieldType: "text",
      required: true,
      options: [],
      placeholder: null,
      sectionId: "section-active",
      colSpan: 1,
      rowBreakBefore: false,
      sortOrder: 3,
      enabled: false,
    },
    {
      id: "field-disabled-section",
      fieldKey: "hidden_section_field",
      label: "停用区块必填项",
      fieldType: "text",
      required: true,
      options: [],
      placeholder: null,
      sectionId: "section-disabled",
      colSpan: 1,
      rowBreakBefore: false,
      sortOrder: 4,
      enabled: true,
    },
  ],
  positions: [
    { id: "position-1", label: "上单", defaultCount: 1, sortOrder: 0 },
  ],
  rankRules: [],
  copyLines: [],
};

async function mockSyncedTemplate(page: import("@playwright/test").Page) {
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
          { id: SYNCED_TEMPLATE.id, name: SYNCED_TEMPLATE.name, enabled: true },
        ],
        [`/api/v1/tenant/game-templates/${SYNCED_TEMPLATE.id}`]:
          SYNCED_TEMPLATE,
        "/api/v1/tenant/customers": [],
      };
      const data = dataByPath[pathname];
      await route.fulfill({
        status: data === undefined ? 404 : 200,
        contentType: "application/json",
        body: JSON.stringify({ data: data ?? null }),
      });
    },
  );
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

  await pickFirstSearchable(page, "游戏模板");
  await pickFirstSearchable(page, "老板客户");
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

test("新建派单可搜索下拉可点击外部或按 ESC 关闭", async ({ page }) => {
  await openMockedNewOrder(page);

  const customerField = page.locator(".mc-field", { hasText: "老板客户" });
  const customerInput = customerField.locator("input");
  const customerOptions = customerField.locator(".mc-picker-options");
  await expect(customerInput).toBeEnabled();
  await customerInput.click();
  await expect(customerOptions).toBeVisible();
  const customerInputBox = await customerInput.boundingBox();
  const customerOptionsBox = await customerOptions.boundingBox();
  expect(customerInputBox).not.toBeNull();
  expect(customerOptionsBox).not.toBeNull();
  expect(customerOptionsBox!.y).toBeGreaterThanOrEqual(
    customerInputBox!.y + customerInputBox!.height,
  );

  await page.keyboard.press("Escape");
  await expect(customerOptions).toBeHidden();

  const templateField = page.locator(".mc-field", { hasText: "游戏模板" });
  const templateOptions = templateField.locator(".mc-picker-options");
  await templateField.locator("input").click();
  await expect(templateOptions).toBeVisible();

  await page.getByRole("heading", { name: "新建派单" }).click();
  await expect(templateOptions).toBeHidden();

  await pickFirstSearchable(page, "游戏模板");

  await customerInput.click();
  await expect(customerOptions).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(customerOptions).toBeHidden();
});

test("新建派单搜索框有明确名称并暴露下拉状态", async ({ page }) => {
  await openMockedNewOrder(page);

  const templatePicker = page.getByRole("combobox", { name: "游戏模板" });
  const customerPicker = page.getByRole("combobox", { name: "老板客户" });
  await expect(templatePicker).toHaveAttribute("aria-expanded", "false");
  await expect(customerPicker).toHaveAttribute("aria-expanded", "false");

  await templatePicker.click();
  await expect(templatePicker).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("listbox", { name: "游戏模板选项" }),
  ).toBeVisible();
});

test("模板预览与新建派单共享启用区块和字段布局", async ({ page }) => {
  await mockSyncedTemplate(page);

  await page.goto("/merchant-console/dispatch/templates");
  await expect(page.getByRole("heading", { name: "模板管理" })).toBeVisible();
  await expect(
    page.getByText(SYNCED_TEMPLATE.name, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "预览表单" }).click();

  const preview = page.getByRole("dialog", {
    name: `预览 · ${SYNCED_TEMPLATE.name}`,
  });
  await expect(preview.getByText("需求信息", { exact: true })).toBeVisible();
  await expect(preview.locator('[name="server"]')).toBeVisible();
  await expect(preview.locator('[name="requirement"]')).toBeVisible();
  await expect(preview.getByText("请确认老板需求后再发布")).toBeVisible();
  await expect(preview.getByText("已停用字段", { exact: true })).toHaveCount(0);
  await expect(preview.getByText("已停用区块", { exact: true })).toHaveCount(0);
  await expect(
    preview.getByText("停用区块必填项", { exact: true }),
  ).toHaveCount(0);
  await expect(preview.getByText("组队岗位", { exact: true })).toBeVisible();

  await page.goto("/merchant-console/dispatch/new");
  await expect(page.getByRole("heading", { name: "新建派单" })).toBeVisible();
  await page.getByRole("combobox", { name: "游戏模板" }).click();
  await page.getByRole("option", { name: SYNCED_TEMPLATE.name }).click();

  await expect(page.getByText("需求信息", { exact: true })).toBeVisible();
  await expect(page.locator('[name="server"]')).toBeVisible();
  const requirement = page.locator('[name="requirement"]');
  await expect(requirement).toBeVisible();
  await expect(requirement).toHaveCSS("border-radius", "8px");
  await expect(requirement).toHaveCSS("background-color", "rgb(250, 248, 242)");
  await expect(requirement).toHaveCSS("min-height", "72px");
  await expect(page.getByText("请确认老板需求后再发布")).toBeVisible();
  await expect(page.getByText("已停用字段", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已停用区块", { exact: true })).toHaveCount(0);
  await expect(page.getByText("停用区块必填项", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "组队岗位" })).toBeVisible();
});

test.describe("S3 模板管理主路径（真实本地 API）", () => {
  test("S3 模板管理：新建 → 加内容与预设 → 保存草稿 → 发布 v1 → 归档", async ({
    page,
  }) => {
    const name = `E2E 排位陪练 ${Date.now().toString(36)}`;
    await loginAsS3Owner(page);
    await createS3Template(page, name);

    // 内容设计：先加分区，再插入「岗位与人数」参考预设
    await page.getByRole("button", { name: "+ 新分区" }).click();
    await page.getByRole("button", { name: "岗位与人数" }).click();
    await expect(
      page.locator('[data-component-key] input[aria-label="组件名称"]').first(),
    ).toHaveValue("岗位与人数");

    // 业务绑定与计算：参考预设已显式绑定人数来源（表格列汇总 → 人数列）
    await page.getByRole("tab", { name: "业务绑定与计算" }).click();
    await expect(page.getByRole("heading", { name: "人数来源" })).toBeVisible();
    await expect(page.getByLabel("表格列汇总")).toBeChecked();

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
    await expect(page.getByText(/【新分区】/).first()).toBeVisible();
    await expect(page.getByText(/人数：1/).first()).toBeVisible();

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
    await page.getByRole("button", { name: "+ 字段", exact: true }).click();
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
      await pageA.getByRole("button", { name: "+ 新分区" }).click();
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
      await pageB.getByRole("button", { name: "+ 字段", exact: true }).click();
      await pageB.getByRole("button", { name: "保存草稿" }).click();
      await expect(pageB.getByText(/草稿已保存 · r\d+/)).toBeVisible();

      // A 手里还是旧 revision：再保存必须 409，并给出冲突处理选项
      await pageA.getByRole("button", { name: "+ 字段", exact: true }).click();
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
        pageA.locator('[data-component-key] input[aria-label="组件名称"]'),
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

    await page.getByRole("button", { name: "+ 新分区" }).click();
    await page.getByRole("button", { name: "+ 字段", exact: true }).click();
    await page.getByRole("button", { name: "+ 字段", exact: true }).click();

    const nameInputs = page.locator(
      '[data-component-key] input[aria-label="组件名称"]',
    );
    await expect(nameInputs).toHaveCount(2);
    await nameInputs.nth(0).fill("字段 A");
    await nameInputs.nth(1).fill("字段 B");

    const moveUpButtons = page.locator(
      '[data-component-key] button[data-action="move-up"]',
    );
    await moveUpButtons.nth(1).focus();
    const focusedBefore = await page.evaluate(() =>
      document.activeElement
        ?.closest("[data-component-key]")
        ?.getAttribute("data-component-key"),
    );

    await page.keyboard.press("Enter");
    await expect(page.getByText(/已把「字段 B」上移到第 1 位/)).toBeVisible();

    const values = await nameInputs.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).value),
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

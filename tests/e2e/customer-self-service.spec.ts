import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { tenantCode } from "./tenant-code";

/**
 * 客户自助下单 v2 跨入口 E2E（设计规格 §7）：客户在 H5 下单 → 客服在商家端按 CS 端口看到该单。
 *
 * 环境（三个本地服务要同时在跑）：
 * - 3100 API：必须是**当前构建**（含 customer/published、customer/template-orders），且指向一次性库；
 * - 3005 admin dev（本项目 baseURL）；
 * - 3101 H5 dev（`/api` 代理到 3100）。
 *
 * 夹具经真实 API 在 s3e2e 租户上创建（客户账号 + 客户档案 + 已发布 v2 模板），不直接写库；
 * 租户与 owner 账号来自 work/s3-e2e-seed.mjs。
 */
const PW = "zcloud1024";
const TENANT_CODE = tenantCode("S3", "s3e2e");
const H5_ORIGIN = process.env.H5_ORIGIN ?? "http://localhost:3101";
const API_ORIGIN = process.env.E2E_API_ORIGIN ?? "http://localhost:3100";

interface ApiResult<T> {
  data: T;
}

async function api<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; token?: string; body?: object } = {},
): Promise<T> {
  const response = await request.fetch(`${API_ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    data: init.body,
  });
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${init.method ?? "GET"} ${path} -> ${response.status()} ${text.slice(0, 200)}`,
    );
  }
  return (JSON.parse(text) as ApiResult<T>).data;
}

/** 模板配置：客户可见的必填文本 + 带加价的单选 + 人数表格 + 只给客服看的字段。 */
function smokeConfig(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    sections: [
      {
        stableKey: "basic",
        label: "基本信息",
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
        stableKey: "server_region",
        sectionKey: "basic",
        label: "区服",
        enabled: true,
        sortOrder: 0,
        layout: { colSpan: 1, rowBreakBefore: false },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: true,
      },
      {
        kind: "FIELD",
        stableKey: "mode",
        sectionKey: "basic",
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
        kind: "FIELD",
        stableKey: "internal_note",
        sectionKey: "basic",
        label: "内部备注",
        enabled: true,
        sortOrder: 2,
        layout: { colSpan: 2, rowBreakBefore: true },
        fieldType: "TEXT",
        semanticRole: "CUSTOM",
        required: false,
        audiences: ["CS"],
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
        defaultRows: [],
      },
    ],
    staffingSource: {
      kind: "REPEATABLE_TABLE_SUM",
      componentKey: "roster_table",
      columnKey: "count",
    },
  };
}

test("客户在 H5 自助下单后，客服在商家端按 CS 端口看到该单", async ({
  page,
  request,
}) => {
  // ---------- 1. 夹具（owner 身份，经真实 API） ----------
  const ownerLogin = await api<{ accessToken: string }>(
    request,
    "/api/v1/auth/login",
    {
      method: "POST",
      body: {
        kind: "tenant",
        tenantCode: TENANT_CODE,
        username: "owner",
        password: PW,
      },
    },
  );
  const ownerToken = ownerLogin.accessToken;

  // 客户 H5 页会读这个能力位：缺失或关闭都会显示"这家门店暂未开启老板自助服务"。
  const features = await api<Array<{ featureKey: string; enabled: boolean }>>(
    request,
    "/api/v1/tenant/features",
    { token: ownerToken },
  );
  expect(
    features.find((row) => row.featureKey === "addon.customer_self_service")
      ?.enabled,
    "s3e2e 需要 addon.customer_self_service；请先跑 work/s3-e2e-seed.mjs",
  ).not.toBe(false);

  const games = await api<Array<{ id: string; name: string }>>(
    request,
    "/api/v1/tenant/catalog/games",
    {
      token: ownerToken,
    },
  );
  const game = games[0];
  if (!game) throw new Error("s3e2e 租户没有游戏，请先跑 work/s3-e2e-seed.mjs");

  // 客户账号（可重复跑：同名账号已存在时后端会 409，这里容忍）
  const accountUsername = "e2e_boss";
  const accountCreate = await request.fetch(
    `${API_ORIGIN}/api/v1/tenant/accounts`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      data: { username: accountUsername, password: PW, roles: ["CUSTOMER"] },
    },
  );
  if (!accountCreate.ok() && accountCreate.status() !== 409) {
    throw new Error(
      `create account -> ${accountCreate.status()} ${await accountCreate.text()}`,
    );
  }
  const accounts = await api<Array<{ id: string; username: string }>>(
    request,
    "/api/v1/tenant/accounts",
    { token: ownerToken },
  );
  const customerAccount = accounts.find(
    (row) => row.username === accountUsername,
  );
  if (!customerAccount) throw new Error("客户账号创建后查不到");

  const customerName = "E2E 自助下单客户";
  const customers = await api<Array<{ id: string; name: string }>>(
    request,
    "/api/v1/tenant/customers",
    { token: ownerToken },
  );
  let customer = customers.find((row) => row.name === customerName);
  if (!customer) {
    customer = await api<{ id: string; name: string }>(
      request,
      "/api/v1/tenant/customers",
      {
        method: "POST",
        token: ownerToken,
        body: { name: customerName },
      },
    );
  }
  await api(request, `/api/v1/tenant/customers/${customer.id}/account`, {
    method: "POST",
    token: ownerToken,
    body: { accountId: customerAccount.id },
  });

  const templateName = `E2E 跨入口模板 ${Date.now().toString(36)}`;
  const created = await api<{ id: string; revision: number }>(
    request,
    "/api/v1/tenant/game-dispatch-templates",
    {
      method: "POST",
      token: ownerToken,
      body: { gameId: game.id, name: templateName, description: null },
    },
  );
  const saved = await api<{ revision: number }>(
    request,
    `/api/v1/tenant/game-dispatch-templates/${created.id}/draft`,
    {
      method: "PATCH",
      token: ownerToken,
      body: { expectedRevision: created.revision, config: smokeConfig() },
    },
  );
  await api(
    request,
    `/api/v1/tenant/game-dispatch-templates/${created.id}/publish`,
    {
      method: "POST",
      token: ownerToken,
      body: { expectedRevision: saved.revision, changeNote: "跨入口 E2E 夹具" },
    },
  );

  // ---------- 2. H5：客户下单 ----------
  await page.goto(`${H5_ORIGIN}/#/pages/customer/game-order/index`);
  await page
    .locator('taro-input-core[name="tenantCode"] input')
    .fill(TENANT_CODE);
  await page
    .locator('taro-input-core[name="username"] input')
    .fill(accountUsername);
  await page.locator('taro-input-core[name="password"] input').fill(PW);
  await page
    .locator("taro-button-core", { hasText: "登录并开始下单" })
    .first()
    .click();

  await page
    .locator("taro-button-core", { hasText: game.name })
    .first()
    .click();
  await page.locator("taro-button-core.cu-choice").first().click();

  // 客户侧只出现 CUSTOMER 可见内容：CS-only 的「内部备注」不渲染
  await expect(
    page.locator('taro-input-core[name="server_region"] input'),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText("内部备注", { exact: true })).toHaveCount(0);

  await page
    .locator('taro-input-core[name="server_region"] input')
    .fill("艾欧尼亚");
  await page.locator("taro-button-core", { hasText: "排位" }).first().click();
  await page.locator("taro-button-core", { hasText: "添加行" }).first().click();
  await page
    .locator('taro-input-core[aria-label="岗位与人数 第 1 行 位置"] input')
    .first()
    .fill("打野");
  await page
    .locator('taro-input-core[aria-label="岗位与人数 第 1 行 人数"] input')
    .first()
    .fill("1");

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/customer/template-orders") &&
      response.request().method() === "POST",
  );
  await page
    .locator("taro-button-core", { hasText: "提交订单" })
    .first()
    .click();
  const createdOrder = (await (await createResponse).json()) as {
    data: { orderId: string };
  };
  const orderId = createdOrder.data.orderId;
  await expect(page.getByText("下单成功", { exact: true }).first()).toBeVisible(
    {
      timeout: 20000,
    },
  );

  // ---------- 3. 客服侧 API：同一张单按 CS 端口可见 ----------
  const detail = await api<{
    formValues: Record<string, unknown>;
    document: { plainText: string } | null;
  }>(request, `/api/v1/tenant/game-dispatch/orders/${orderId}`, {
    token: ownerToken,
  });
  expect(detail.formValues.server_region).toBe("艾欧尼亚");
  expect(detail.document?.plainText ?? "").toContain("艾欧尼亚");
  expect(detail.document?.plainText ?? "").toContain("打野");

  // ---------- 4. 商家端：客服在订单详情看到该单 ----------
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill(TENANT_CODE);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PW);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);

  await page.goto(`/merchant-console/dispatch/${orderId}?kind=GD`);
  await expect(page).toHaveURL(new RegExp(orderId));
  await expect(page.getByText("艾欧尼亚").first()).toBeVisible({
    timeout: 20000,
  });
});

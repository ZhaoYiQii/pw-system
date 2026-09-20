/**
 * 算价模型 Task 5：报单/审批/释放名额与费用口径的走查用例（含视觉基线）。
 *
 * 夹具（必须先生成，否则整组用例 skipped）：
 *   DATABASE_URL=postgresql://pw:pw_dev_only@127.0.0.1:5433/pw_saas_s2_task2_20260916?schema=public \
 *   API_BASE=http://127.0.0.1:3300 node work/s5c-walkthrough-seed.mjs scenario
 * 环境：
 *   - 商家端建议 `next build && next start -p 3005`（本地 next dev 在部分环境水合不完整）；
 *   - H5 需静态服务托管 `apps/mobile/dist` 并把 /api 反代到 API（用例 4 走 3101）；
 *   - API 需设置 ADMIN_WEB_ORIGIN / H5_ORIGIN 白名单。
 * 订单状态是走查用例的输入：夹具生成「已发布 / 已选定 / 待审批报单」三单，
 * 用例按状态从 API 里发现它们（不硬编码 id），所以顺序执行、跑完需重新 seed。
 */
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const TENANT_CODE = process.env.W5_TENANT_CODE ?? "s5cwalk";
const PASSWORD = process.env.W5_PASSWORD ?? "zcloud1024";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3300";
const H5_ORIGIN = process.env.H5_ORIGIN ?? "http://127.0.0.1:3101";
/** 基线里屏蔽所有「日期/时间/UUID/派单号」这类易变文本。 */
const VOLATILE_TEXT = /\d{4}\/\d{1,2}\/\d{1,2}|^[0-9a-f-]{36}$|^GD[A-Z0-9]+$/;

interface DispatchRow {
  orderId: string;
  dispatchNo: string;
  status: string;
}

async function loginApi(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/v1/auth/login", {
    data: {
      kind: "tenant",
      tenantCode: TENANT_CODE,
      username: "owner",
      password: PASSWORD,
    },
  });
  if (!res.ok()) return "";
  return (await res.json()).data.accessToken as string;
}

/**
 * 从 API 里发现夹具订单（不硬编码 id）。注意：Playwright 的 `request` 夹具 baseURL 指向
 * 商家端，这里必须显式用 API 地址新建上下文，否则登录会打到前端页面。
 */
async function discoverFixture(): Promise<{
  pending: DispatchRow;
  assigned: DispatchRow;
  sessionId: string;
} | null> {
  const api = await request.newContext({ baseURL: API_BASE });
  try {
    const token = await loginApi(api);
    if (!token) return null;
    const headers = { authorization: `Bearer ${token}` };
    const list = await api.get("/api/v1/tenant/game-dispatch", { headers });
    if (!list.ok()) return null;
    const rows = (await list.json()).data as DispatchRow[];
    const pending = rows.find((row) => row.status === "PENDING_CONFIRMATION");
    const assigned = rows.find((row) => row.status === "ASSIGNED");
    if (!pending || !assigned) return null;
    const sessions = await api.get("/api/v1/tenant/sessions", { headers });
    if (!sessions.ok()) return null;
    const sessionRows = (await sessions.json()).data as Array<{
      id: string;
      orderId: string;
      flow: string;
    }>;
    const session = sessionRows.find(
      (row) => row.orderId === pending.orderId && row.flow === "GAME_DISPATCH",
    );
    if (!session) return null;
    return { pending, assigned, sessionId: session.id };
  } finally {
    await api.dispose();
  }
}

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto("/store/login");
  await page.waitForTimeout(3000);
  await page.getByLabel("门店 code").fill(TENANT_CODE);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  const button = page.getByRole("button", { name: "登录" });
  const loggedIn = await Promise.all([
    page.waitForURL(/merchant-console\/work/, { timeout: 20000 }).then(
      () => true,
      () => false,
    ),
    button.click(),
  ]).then(([ok]) => ok);
  expect(loggedIn, "门店登录失败（检查 API CORS 白名单与夹具）").toBe(true);
}

test.describe("算价模型：报单审批 / 释放名额 / 费用口径", () => {
  test.beforeAll(async () => {
    const fixture = await discoverFixture();
    test.skip(
      fixture === null,
      "缺少走查夹具：先运行 work/s5c-walkthrough-seed.mjs scenario",
    );
  });

  test("派单详情：未备齐时不给结算入口，单价与人数口径正确", async ({
    page,
  }) => {
    const fixture = await discoverFixture();
    await loginAsOwner(page);
    await page.goto(`/game-dispatch/${fixture!.pending.orderId}`);
    await page.getByTestId("fees-summary").waitFor({ timeout: 20000 });

    // 展示口径（规格 §3.4）：报名记录显示单价，不乘时长。
    await expect(page.getByText("¥70.00 / 小时").first()).toBeVisible();
    // 走查修复 F3：位置行按已选中人数算，已选定后应为「人数已足够」。
    await expect(page.getByText("人数已足够").first()).toBeVisible();
    // 走查修复 F2：未备齐时没有可点的结算按钮，改为说明原因。
    await expect(page.getByRole("button", { name: "确认结算" })).toHaveCount(0);
    await expect(
      page.getByText("还有 1 个档位未完成报单审批，暂不能结算。"),
    ).toBeVisible();
    // 费用口径（Task 5b-2/A）：未核定前支出为 0，抽成标注「未分账」。
    const fees = page.getByTestId("fees-summary");
    await expect(fees.getByText("¥0.00").first()).toBeVisible();
    // 未核定前门店抽成与平台费都按「未分账」显示（ADR-0004 后分账是常态，历史/未核定才标未分账）。
    await expect(fees.getByText("未分账").first()).toBeVisible();
    await expect(fees).toHaveScreenshot("fees-summary-before-review.png", {
      mask: [page.getByText(VOLATILE_TEXT)],
    });
  });

  test("场次详情：报单审批带三张证据，可通过并留痕", async ({ page }) => {
    const fixture = await discoverFixture();
    await loginAsOwner(page);
    await page.goto(`/merchant-console/sessions/${fixture!.sessionId}`);
    const panel = page.getByTestId("report-review");
    await panel.waitFor({ timeout: 20000 });

    await expect(panel.getByText("报单审批")).toBeVisible();
    // 证据卡片在「证据」区块：报单开始/结束截图与计时证据共用同一条通道。
    await expect(page.getByText("报单开始截图")).toBeVisible();
    await expect(page.getByText("报单结束截图")).toBeVisible();
    await expect(panel.getByText("申报 / 核定时长")).toBeVisible();
    // exact 限定：D2 的差异提示里也会出现「90 分钟」，避免 strict 模式撞成两处命中。
    await expect(panel.getByText("90 分钟", { exact: true })).toBeVisible();
    // P3 / D2：审批卡片给出「申报 vs 证据计时」对照；夹具申报 90 分钟、证据仅约 1 秒，
    // 差异远超阈值，必须出现高亮提示（但不影响审批结果）。
    await expect(page.getByTestId("report-duration-gap")).toBeVisible();
    await expect(page.getByTestId("report-duration-gap-warning")).toBeVisible();
    await expect(
      page.getByText("与证据计时差异较大，请重点核对开始/结束截图"),
    ).toBeVisible();
    await expect(panel).toHaveScreenshot("report-review-pending.png", {
      mask: [page.getByText(VOLATILE_TEXT)],
    });

    await panel.getByRole("button", { name: /通过/ }).click();
    await expect(page.getByText("已通过").first()).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText("该报单已通过，金额已按核定分钟数落库"),
    ).toBeVisible();
  });

  test("备齐后可结算：费用口径给出支出/实收/毛利", async ({ page }) => {
    const fixture = await discoverFixture();
    await loginAsOwner(page);
    await page.goto(`/game-dispatch/${fixture!.pending.orderId}`);
    const fees = page.getByTestId("fees-summary");
    await fees.waitFor({ timeout: 20000 });

    // 90 分钟 × ¥70/小时 = ¥105.00（与 confirm-settlement 扣款口径一致）。
    await expect(fees.getByText("¥105.00").first()).toBeVisible();
    await expect(fees.getByText("已核定档位 1 / 生效档位 1。")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认结算" })).toBeVisible();
    await expect(fees).toHaveScreenshot("fees-summary-after-review.png", {
      mask: [page.getByText(VOLATILE_TEXT)],
    });
  });

  test("释放名额与记违约：状态与台账即时更新", async ({ page }) => {
    const fixture = await discoverFixture();
    await loginAsOwner(page);
    await page.goto(`/game-dispatch/${fixture!.assigned.orderId}`);
    const breachList = page.getByTestId("breach-list");
    await breachList.waitFor({ timeout: 20000 });

    page.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt")
        await dialog.accept("走查：约定时间未到场");
      else await dialog.accept();
    });
    await page.getByRole("button", { name: "记违约" }).first().click();
    await expect(breachList.getByText("走查：约定时间未到场")).toBeVisible({
      timeout: 20000,
    });
    // 违约记录卡片只含「陪玩名 + 记录时间 + 事由」，时间口径随运行时刻变化；
    // 这里保留文本断言，不做整卡基线（稳定部分已被上面的断言覆盖）。

    await page.getByRole("button", { name: "释放名额" }).first().click();
    await expect(
      page.getByText("已释放名额：订单回到报名阶段并重开一轮，可重新选人。"),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("RELEASED").first()).toBeVisible();
  });

  test("陪玩端 H5：未开通经典大厅也能报名（单价 + 报名入口）", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 414, height: 896 },
      baseURL: H5_ORIGIN,
    });
    const page = await context.newPage();
    try {
      await page.goto("/#/pages/player/order-hall/index");
      await page.waitForTimeout(3000);
      const inputs = page.locator("input");
      await inputs.nth(0).fill(TENANT_CODE);
      await inputs.nth(1).fill("player1");
      await inputs.nth(2).fill(PASSWORD);
      await page.getByText("登录并查看可接订单").first().click();
      await page.waitForTimeout(3500);

      // 走查修复 F1：经典大厅未开通时页面仍可用（不退登录卡），并且能看到游戏派单。
      await expect(
        page.getByText("游戏派单 · 可报名（选中前可自助取消）"),
      ).toBeVisible();
      await expect(page.getByText("¥70.00 / 小时").first()).toBeVisible();
      await expect(
        page.getByText("报名", { exact: true }).first(),
      ).toBeVisible();
      // 移动端大厅条数随夹具状态变化（发布/释放后都算 DISPATCHING），这里只断言不做基线；
      // 稳定的卡片级基线等主链断言稳定后再补（见文件头说明）。
    } finally {
      await context.close();
    }
  });
});

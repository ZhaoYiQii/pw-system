/**
 * 算价模型 Task 2（商家端「算价模型」维护页）+ Task 5 §3.4（老板端单价）的走查用例。
 *
 * 夹具/环境：同 pricing-slot-report.spec.ts（先跑 work/s5c-walkthrough-seed.mjs scenario 造
 * 走查门店 s5cwalk；商家端建议生产构建启动；缺夹具时整组失败（不再静默 skip））。
 */
import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { tenantCode } from "./tenant-code";

const TENANT_CODE = tenantCode("W5", "s5cwalk");
const PASSWORD = process.env.W5_PASSWORD ?? "zcloud1024";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:3300";
const H5_ORIGIN = process.env.H5_ORIGIN ?? "http://127.0.0.1:3101";
/** 基线里屏蔽日期/时间/UUID/派单号等易变文本。 */
const VOLATILE_TEXT = /\d{4}\/\d{1,2}\/\d{1,2}|^[0-9a-f-]{36}$|^GD[A-Z0-9]+$/;

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

/** 夹具是否就绪：能登录、能看到走查门店的游戏与派单。 */
async function fixtureReady(): Promise<boolean> {
  const api = await request.newContext({ baseURL: API_BASE });
  try {
    const token = await loginApi(api);
    if (!token) return false;
    const res = await api.get("/api/v1/tenant/game-dispatch", {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok();
  } finally {
    await api.dispose();
  }
}

test.describe("算价模型：商家端维护页与老板端单价", () => {
  test.beforeAll(async () => {
    // 缺夹具必须响亮失败：静默 skip 会让「这组压根没跑」看起来像绿。
    if (!(await fixtureReady()))
      throw new Error(
        "缺少走查夹具：先运行 work/s5c-walkthrough-seed.mjs scenario 再造一次夹具（缺夹具不再静默 skip）",
      );
  });

  test("商家端「算价模型」页：加价规则与陪玩底价（含来源标注）", async ({
    page,
  }) => {
    await page.goto("/store/login");
    await page.waitForTimeout(3000);
    await page.getByLabel("门店 code").fill(TENANT_CODE);
    await page.getByLabel("账号").fill("owner");
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/merchant-console\/work/, { timeout: 20000 });

    await page.goto("/merchant-console/pricing");
    const rulesCard = page.getByTestId("pricing-rules-card");
    await rulesCard.waitFor({ timeout: 20000 });

    // 口径说明（本页的核心语义）与夹具里的 1 条加价（rank=钻石 1000 分 ≈ ¥10.00）。
    await expect(
      page.getByText(
        "单价 = 底价（陪玩×游戏，缺省用陪玩级兜底）+ 命中的加价之和；金额一律整数分。",
      ),
    ).toBeVisible();
    await expect(page.getByText("1 条加价")).toBeVisible();
    await expect(rulesCard.getByText("该游戏的加价规则")).toBeVisible();
    await expect(rulesCard.getByText("10.00").first()).toBeVisible();
    await expect(rulesCard).toHaveScreenshot("pricing-rules-card.png", {
      mask: [page.getByText(VOLATILE_TEXT)],
    });

    const baseCard = page.getByTestId("player-base-card");
    await expect(baseCard.getByText("陪玩×游戏底价")).toBeVisible();
    // 陪玩级兜底来源要显式标注（5500 是夹具里「走查陪玩乙」的兜底底价）。
    await expect(baseCard.getByText("陪玩级兜底").first()).toBeVisible();
    await expect(baseCard.getByText("5500（兜底）").first()).toBeVisible();
    await expect(baseCard).toHaveScreenshot("player-base-card.png", {
      mask: [page.getByText(VOLATILE_TEXT)],
    });
  });

  test("老板端 H5 选人页：每个候选人显示同一个单价（不乘时长）", async ({
    page,
  }) => {
    const api = await request.newContext({ baseURL: API_BASE });
    const token = await loginApi(api);
    const list = await api.get("/api/v1/tenant/game-dispatch", {
      headers: { authorization: `Bearer ${token}` },
    });
    const rows = (await list.json()).data as Array<{
      orderId: string;
      status: string;
    }>;
    // 用「已发布（DISPATCHING）」那一单：夹具里由「走查陪玩乙」报名（兜底 5500 + rank=钻石 1000 = 6500）。
    const published = rows.find((row) => row.status === "DISPATCHING");
    await api.dispose();
    expect(published, "夹具里应有 DISPATCHING 的派单").toBeTruthy();

    await page.goto(
      `${H5_ORIGIN}/#/pages/customer/game-select/index?orderId=${published!.orderId}`,
    );
    await page.waitForTimeout(3000);
    const inputs = page.locator("input");
    await inputs.nth(0).fill(TENANT_CODE);
    await inputs.nth(1).fill("boss");
    await inputs.nth(2).fill(PASSWORD);
    await page.getByText("登录并查看候选").first().click();
    await page.waitForTimeout(3500);

    // 展示口径（规格 §3.4）：老板与陪玩看到同一个单价数字，不乘时长。
    await expect(page.getByText("¥65.00 / 小时").first()).toBeVisible();
    await expect(
      page.getByText("选择陪玩", { exact: true }).first(),
    ).toBeVisible();
    // 老板端按「当前候选人」渲染，列表条数随夹具状态变化（发布/释放后都算候选），
    // 整页基线会误报；上述文本断言（单价 ¥65.00/小时 + 选人入口）即规格 §3.4 的口径证据。
  });
});

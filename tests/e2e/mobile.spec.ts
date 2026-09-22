import { expect, test } from "@playwright/test";
import { tenantCode } from "./tenant-code";

const PASSWORD = "zcloud1024";
/** 门店 code 统一走 tenantCode()：DEV_E2E_TENANT_CODE > E2E_TENANT_CODE > 默认 c1（c1 只在 dev 库存在）。 */
const TENANT_CODE = tenantCode("DEV", "c1");

/**
 * H5 账号密码登录（陪玩端 / 老板端共用同一套表单）。
 *
 * 两个页面的可访问名称不一样（同一套 Taro 输入组件，label 关联方式不同）：
 * - 陪玩端：textbox 的可访问名称取自字段标签（「门店 code」「陪玩账号」「密码」）；
 * - 老板端：textbox 的可访问名称取自 placeholder，字段标签挂在外层容器上。
 * 所以按「先 label、再 placeholder 兜底」定位——避免用单一写法把另一个页面打红
 * （本用例之前就是因为写死 placeholder 而红的）。
 */
async function loginOnH5(
  page: import("@playwright/test").Page,
  input: {
    accountLabel: string;
    account: string;
    accountPlaceholder: string;
    submit: string;
  },
) {
  const fillByLabelOrPlaceholder = async (
    label: string,
    placeholder: string,
    value: string,
  ) => {
    // 两个选择器交给 Playwright 自己等（`or`），不要先 count——
    // count 在元素还没挂载时会立刻返回 0，于是错误地走进兜底分支再超时。
    const field = page
      .getByRole("textbox", { name: label })
      .or(page.getByRole("textbox", { name: placeholder }));
    await field.first().fill(value);
  };
  await fillByLabelOrPlaceholder("门店 code", "demo", TENANT_CODE);
  await fillByLabelOrPlaceholder(
    input.accountLabel,
    input.accountPlaceholder,
    input.account,
  );
  await fillByLabelOrPlaceholder("密码", "••••", PASSWORD);
  await page.getByText(input.submit).click();
}

test("陪玩可在 H5 登录并看到收入入口", async ({ page }) => {
  await page.goto("/#/pages/player/profile/index");
  await loginOnH5(page, {
    accountLabel: "陪玩账号",
    account: "player",
    accountPlaceholder: "player",
    submit: "账号密码登录",
  });
  await expect(page.locator("#app").getByText("我的资料")).toBeVisible();
  await expect(page.locator("#app").getByText("收入详情")).toBeVisible();
});

test("老板可在 H5 登录并打开钱包", async ({ page }) => {
  await page.goto("/#/pages/customer/wallet/index");
  await loginOnH5(page, {
    accountLabel: "老板账号",
    account: "customer",
    accountPlaceholder: "customer",
    submit: "登录并查看钱包",
  });
  await expect(page.getByText(/账户余额/)).toBeVisible();
});

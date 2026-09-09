import { expect, test } from "@playwright/test";

const PASSWORD = "Dev-Password-123";

test("陪玩可在 H5 登录并看到收入入口", async ({ page }) => {
  await page.goto("/#/pages/player/profile/index");
  await page.getByRole("textbox", { name: "demo" }).fill("c1");
  await page.getByRole("textbox", { name: "player" }).fill("player");
  await page.getByRole("textbox", { name: "请输入密码" }).fill(PASSWORD);
  await page.getByText("账号密码登录").click();
  await expect(page.locator("#app").getByText("我的资料")).toBeVisible();
  await expect(page.locator("#app").getByText("收入详情")).toBeVisible();
});

test("老板可在 H5 登录并打开钱包", async ({ page }) => {
  await page.goto("/#/pages/customer/wallet/index");
  await page.getByRole("textbox", { name: "demo" }).fill("c1");
  await page.getByRole("textbox", { name: "customer" }).fill("customer");
  await page.getByRole("textbox", { name: "••••" }).fill(PASSWORD);
  await page.getByText("登录并查看钱包").click();
  await expect(page.getByText(/账户余额/)).toBeVisible();
});

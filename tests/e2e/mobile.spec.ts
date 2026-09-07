import { expect, test } from "@playwright/test";

const PASSWORD = "Dev-Password-123";

test("陪玩可在 H5 登录并看到收入入口", async ({ page }) => {
  await page.goto("/#/pages/player/profile/index");
  await page.getByRole("textbox", { name: "demo" }).fill("c1");
  await page.getByRole("textbox", { name: "player" }).fill("player");
  await page.getByRole("textbox", { name: "••••" }).fill(PASSWORD);
  await page.getByText("登录并读取资料").click();
  await expect(page.getByText("我的陪玩资料")).toBeVisible();
  await expect(page.getByText("收入详情")).toBeVisible();
});

test("老板可在 H5 登录并打开钱包", async ({ page }) => {
  await page.goto("/#/pages/customer/wallet/index");
  await page.getByRole("textbox", { name: "门店 code" }).fill("c1");
  await page.getByRole("textbox", { name: "老板账号" }).fill("customer");
  await page.getByRole("textbox", { name: "密码" }).fill(PASSWORD);
  await page.getByText("登录").click();
  await expect(page.getByText(/老板编号/)).toBeVisible();
});

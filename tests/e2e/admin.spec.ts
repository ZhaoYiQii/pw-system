import { expect, test } from "@playwright/test";

const PASSWORD = "Dev-Password-123";

test("平台管理员可登录并进入租户管理", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/tenants$/);
  await expect(page.getByRole("heading", { name: "平台租户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键开通" })).toBeVisible();
});

test("门店账号可登录并打开订单管理", async ({ page }) => {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill("c1");
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "门店设置" })).toBeVisible();

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "订单" })).toBeVisible();
  await expect(page.getByText(/订单列表/)).toBeVisible();
});

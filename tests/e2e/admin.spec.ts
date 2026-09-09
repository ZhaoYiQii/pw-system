import { expect, test } from "@playwright/test";

const PASSWORD = "Dev-Password-123";

test("平台管理员可登录总览并进入门店管理", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("账号").fill("admin");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible();
  await page.getByRole("link", { name: "门店管理" }).click();
  await expect(page).toHaveURL(/\/tenants$/);
  await expect(page.getByRole("heading", { name: "门店管理" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /一键开店/, exact: false }).first(),
  ).toBeVisible();
});

test("门店账号登录后进入新商家控制台并打开订单管理", async ({ page }) => {
  await page.goto("/store/login");
  await page.getByLabel("门店 code").fill("c1");
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/merchant-console\/work$/);
  await expect(page.getByText("owner", { exact: true }).first()).toBeVisible();

  await page.goto("/merchant-console/dispatch");
  await expect(
    page.getByRole("heading", { name: "订单与派单" }),
  ).toBeVisible();
});

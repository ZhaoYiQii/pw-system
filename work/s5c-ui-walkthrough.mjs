// 5c 走查：用 Playwright 驱动商家端与移动端 H5，截图并收集控制台/网络问题（临时脚本）。
// 用法：ADMIN_BASE / H5_BASE / SHOT_DIR / ORDER_ASSIGNED / ORDER_REPORT / SESSION_ID 由环境变量传入。
// 环境要求（2026-09-20 实测）：
//   - 商家端用生产构建 `next build && next start -p 3005`（本地 `next dev` 在沙箱内水合失败）；
//   - H5 静态服务需把 /api 反代到 API（H5 按同源调用），API 需设置 ADMIN_WEB_ORIGIN / H5_ORIGIN 白名单；
//   - 夹具由 work/s5c-walkthrough-seed.mjs 生成，跑完用 clean 清理。
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const ADMIN = process.env.ADMIN_BASE ?? "http://127.0.0.1:3005";
const H5 = process.env.H5_BASE ?? "http://127.0.0.1:3101";
const OUT = process.env.SHOT_DIR ?? ".";
const ORDER_ASSIGNED = process.env.ORDER_ASSIGNED ?? "";
const ORDER_REPORT = process.env.ORDER_REPORT ?? "";
const SESSION_ID = process.env.SESSION_ID ?? "";
const tenantCode = process.env.WALK_TENANT ?? "s5cwalk";
const password = process.env.WALK_PASSWORD ?? "zcloud1024";

const issues = [];
const steps = [];

function attach(page, label) {
  page.on("request", (req) => {
    if (req.url().includes("/api/"))
      issues.push({ label, kind: "request", text: `${req.method()} ${req.url()}`.slice(0, 200) });
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/"))
      issues.push({ label, kind: "api-response", text: `${res.status()} ${res.url()}`.slice(0, 200) });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") issues.push({ label, kind: "console", text: msg.text().slice(0, 300) });
  });
  page.on("pageerror", (err) => issues.push({ label, kind: "pageerror", text: String(err).slice(0, 300) }));
  page.on("response", (res) => {
    if (res.status() >= 500) issues.push({ label, kind: "http", text: `${res.status()} ${res.url()}`.slice(0, 300) });
  });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  steps.push({ name, file });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  // ---------- 商家端（SKIP_ADMIN=1 时跳过，便于只重跑移动端） ----------
  if (process.env.SKIP_ADMIN !== "1") {
  const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await admin.newPage();
  attach(page, "admin");
  await page.goto(`${ADMIN}/store/login`, { waitUntil: "domcontentloaded" });
  // Next dev 首次编译较慢：等页面可交互（按钮 enabled）再填表，避免点击打在未 hydrate 的 SSR 壳上。
  const submitButton = page.getByRole("button", { name: "登录" });
  await submitButton.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.getByLabel("门店 code").fill(tenantCode);
  await page.getByLabel("账号").fill("owner");
  await page.getByLabel("密码").fill(password);
  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt += 1) {
    await submitButton.click();
    loggedIn = await page
      .waitForURL(/merchant-console\/work/, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!loggedIn) await page.waitForTimeout(2000);
  }
  if (!loggedIn) {
    await shot(page, "01b-admin-login-failed");
    steps.push({
      name: "admin-login-failed",
      url: page.url(),
      texts: (await page.locator("body").innerText()).slice(0, 800),
    });
    throw new Error("admin login failed");
  }
  await shot(page, "01-admin-workbench");

  // 派单详情（待审批报单）：费用口径 + 释放/违约入口
  await page.goto(`${ADMIN}/game-dispatch/${ORDER_REPORT}`, { waitUntil: "domcontentloaded" });
  await page.getByText("费用口径").first().waitFor({ timeout: 20000 });
  await shot(page, "02-admin-order-report-pending");
  steps.push({
    name: "order-report-pending-texts",
    texts: (await page.locator("main, body").first().innerText()).slice(0, 1500),
  });

  // 场次详情：报单审批 + 截图预览
  await page.goto(`${ADMIN}/merchant-console/sessions/${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await page.getByText("报单审批").first().waitFor({ timeout: 20000 });
  await shot(page, "03-admin-session-report-pending");
  await page.locator(".mc-ev-card").first().click();
  await page.waitForTimeout(1200);
  const previewOpened = admin.pages().length;
  steps.push({ name: "evidence-preview-pages", previewOpened });
  const approve = page.getByRole("button", { name: /通过/ }).first();
  await approve.click();
  await page.waitForTimeout(1500);
  await shot(page, "04-admin-session-approved");
  steps.push({
    name: "session-approved-texts",
    texts: (await page.locator("body").innerText()).slice(0, 1500),
  });

  // 审批后回派单详情：费用口径应有支出/实收
  await page.goto(`${ADMIN}/game-dispatch/${ORDER_REPORT}`, { waitUntil: "domcontentloaded" });
  await page.getByText("费用口径").first().waitFor({ timeout: 20000 });
  await shot(page, "05-admin-order-after-approve");
  steps.push({
    name: "order-after-approve-texts",
    texts: (await page.locator("body").innerText()).slice(0, 1500),
  });

  // 记违约 + 释放名额（已选定场景）
  await page.goto(`${ADMIN}/game-dispatch/${ORDER_ASSIGNED}`, { waitUntil: "domcontentloaded" });
  await page.getByText("违约记录").first().waitFor({ timeout: 20000 });
  await shot(page, "06-admin-order-assigned");
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("走查：约定时间未到场");
    else await dialog.accept();
  });
  await page.getByRole("button", { name: "记违约" }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, "07-admin-breach-recorded");
  await page.getByRole("button", { name: "释放名额" }).first().click();
  await page.waitForTimeout(1800);
  await shot(page, "08-admin-slot-released");
  steps.push({
    name: "released-texts",
    texts: (await page.locator("body").innerText()).slice(0, 1500),
  });
  }

  // ---------- 移动端 H5（陪玩端） ----------
  const mobile = await browser.newContext({
    viewport: { width: 414, height: 896 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const h5 = await mobile.newPage();
  attach(h5, "h5-player");
  const hallUrl = `${H5}/#/pages/player/order-hall/index`;
  await h5.goto(hallUrl, { waitUntil: "domcontentloaded" });
  await h5.waitForTimeout(2500);
  const hallBody = await h5.locator("body").innerText();
  steps.push({ name: "h5-first-paint", texts: hallBody.slice(0, 800) });
  await shot(h5, "09-h5-player-hall-login");

  const tenantInput = h5.locator("input").first();
  if ((await tenantInput.count()) > 0) {
    const inputs = h5.locator("input");
    const total = await inputs.count();
    if (total >= 3) {
      await inputs.nth(0).fill(tenantCode);
      await inputs.nth(1).fill("player1");
      await inputs.nth(2).fill(password);
      // Taro H5 的按钮是自定义元素（taro-button-core），不能按 role=button 匹配，用文案点击。
      await h5.getByText("登录并查看可接订单").first().click();
      await h5.waitForTimeout(3500);
    }
  }
  await shot(h5, "10-h5-player-hall");
  steps.push({
    name: "h5-hall-texts",
    texts: (await h5.locator("body").innerText()).slice(0, 1500),
  });

  await h5.getByText("我的接单").first().click().catch(() => {});
  await h5.waitForTimeout(1200);
  await shot(h5, "11-h5-player-my-applications");
  steps.push({
    name: "h5-my-applications-texts",
    texts: (await h5.locator("body").innerText()).slice(0, 1500),
  });

  await h5.getByText("服务").first().click().catch(() => {});
  await h5.waitForTimeout(1500);
  await shot(h5, "12-h5-player-service");
  steps.push({
    name: "h5-service-texts",
    texts: (await h5.locator("body").innerText()).slice(0, 1500),
  });

  // 老板端选人页（单价）
  const boss = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const bossPage = await boss.newPage();
  attach(bossPage, "h5-boss");
  await bossPage.goto(`${H5}/#/pages/customer/game-select/index?orderId=${ORDER_ASSIGNED}`, {
    waitUntil: "domcontentloaded",
  });
  await bossPage.waitForTimeout(3000);
  await shot(bossPage, "13-h5-boss-select");
  steps.push({
    name: "h5-boss-select-texts",
    texts: (await bossPage.locator("body").innerText()).slice(0, 1200),
  });
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(OUT, "walkthrough-report.json"),
    JSON.stringify({ steps, issues }, null, 2),
  );
  console.log(JSON.stringify({ shots: steps.length, issues }, null, 2));
}

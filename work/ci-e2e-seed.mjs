/**
 * CI 的 H5 E2E 夹具（`mobile-h5` project）。
 *
 * 为什么需要独立脚本：`mobile-h5` 跑的是「陪玩/老板在 H5 登录后能看到自己的页面」，
 * 这要求门店下**同时存在账号与其档案**（陪玩「我的资料」读本人档案、老板钱包读客户档案）。
 * `scripts/seed-dev.mjs` 只建账号不建档案，所以在纯净 CI 库上跑不出可用夹具。
 *
 * 只允许跑在一次性/测试库上（与 s3/s4 夹具同一道防线），幂等 upsert，可重复执行。
 * 用法：
 *   DATABASE_URL=postgresql://.../pw_ci?schema=public node work/ci-e2e-seed.mjs
 */
import { createDatabaseClient } from "@pw/database";
import { hashPassword } from "../apps/api/dist/modules/identity-access/infrastructure/password.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const databaseName = new URL(url).pathname.replace(/^\//, "");
// 与其它 E2E 夹具同一道防线：拒绝动开发库，避免误清本地数据。
if (!/(^|_)ci$|test|e2e/i.test(databaseName)) {
  throw new Error(`refusing to touch database: ${databaseName}`);
}

const tenantCode = process.env.CI_E2E_TENANT_CODE ?? "c1";
const password = process.env.CI_E2E_PASSWORD ?? "zcloud1024";

const client = createDatabaseClient(url);
const hash = await hashPassword(password);

const tenant = await client.tenant.upsert({
  where: { code: tenantCode },
  update: {},
  create: { code: tenantCode, name: "CI E2E 门店" },
});

/** 账号 + 角色（幂等）。 */
async function ensureAccount(username, role) {
  const account = await client.tenantAccount.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username } },
    update: { passwordHash: hash, status: "ACTIVE" },
    create: {
      tenantId: tenant.id,
      username,
      passwordHash: hash,
      status: "ACTIVE",
    },
  });
  const existingRole = await client.tenantAccountRole.findFirst({
    where: { tenantId: tenant.id, tenantAccountId: account.id, role },
  });
  if (!existingRole) {
    await client.tenantAccountRole.create({
      data: {
        tenantId: tenant.id,
        tenantAccountId: account.id,
        role,
      },
    });
  }
  return account;
}

// 陪玩：H5「我的资料 / 收入入口」要读本人档案。
const playerAccount = await ensureAccount("player", "PLAYER");
const existingPlayer = await client.playerProfile.findFirst({
  where: { tenantId: tenant.id, tenantAccountId: playerAccount.id },
});
if (!existingPlayer) {
  await client.playerProfile.create({
    data: {
      tenantId: tenant.id,
      name: "CI 陪玩",
      tenantAccountId: playerAccount.id,
      // 单价底价（分/小时）：H5 大厅与结算口径都按整数分，给一个非零值便于断言。
      basePricePerHourFen: 6000n,
    },
  });
}

// 老板：H5 钱包页读本人客户档案与钱包。
const customerAccount = await ensureAccount("customer", "CUSTOMER");
const existingCustomer = await client.customerProfile.findFirst({
  where: { tenantId: tenant.id, tenantAccountId: customerAccount.id },
});
if (!existingCustomer) {
  await client.customerProfile.create({
    data: {
      tenantId: tenant.id,
      name: "CI 老板",
      tenantAccountId: customerAccount.id,
    },
  });
}

await client.$disconnect();
console.log(
  `ci e2e seed ok: tenant=${tenantCode} accounts=player,customer password=${password} database=${databaseName}`,
);
